-- Event Budget v2: custom categories for every editor + normalized de-duplication + admin rename.
-- * Category names are cleaned the same way everywhere: control chars → space, inner whitespace collapsed, trimmed.
-- * Uniqueness is case- and spacing-insensitive (unique index on the cleaned, lower-cased name).
-- * budget_save_item lets admins AND editors create a new category on the fly (validated: 1–60 chars,
--   not a generic "Others"), logged in budget_activity; viewers still cannot write anything.
-- * budget_admin_rename_category renames a category and every expense filed under it.
-- No existing data changes (checked 2026-11-17: 19 categories, 0 normalization collisions).

create or replace function public._budget_clean_cat(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

update public.budget_categories set name = public._budget_clean_cat(name) where name <> public._budget_clean_cat(name);
update public.budget_items set category = public._budget_clean_cat(category) where category <> public._budget_clean_cat(category);

drop index if exists public.budget_categories_name_uq;
create unique index budget_categories_name_uq on public.budget_categories (budget_id, lower(public._budget_clean_cat(name)));

create or replace function public.budget_save_item(
  p_item jsonb, p_token text default null, p_passcode text default null, p_budget uuid default null,
  p_client_request_id uuid default null, p_expected_version int default null, p_actor_name text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  ctx jsonb := public._budget_resolve(p_token, p_passcode, p_budget);
  bid uuid; old public.budget_items; rec public.budget_items; v_id uuid;
  v_title text; v_cat text; v_qty numeric; v_price numeric; v_status text; v_paid numeric; v_total numeric;
  v_vendor text; v_date date; v_notes text; v_rpath text; v_rname text; label text; diff jsonb := '{}'::jsonb; k text; v_found text;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  if ctx->>'role' not in ('admin','editor') then return jsonb_build_object('ok', false, 'error', 'read_only'); end if;
  if jsonb_typeof(p_item) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Missing item'); end if;
  bid := (ctx->>'budget_id')::uuid;
  label := public._budget_actor_label(ctx, p_actor_name);

  -- duplicate submit (double click / network retry) → hand back the row already created
  if p_client_request_id is not null and (p_item->>'id') is null then
    select * into rec from public.budget_items where client_request_id = p_client_request_id;
    if found then
      if rec.budget_id <> bid then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
      return jsonb_build_object('ok', true, 'duplicate', true, 'item', public._budget_item_json(rec));
    end if;
  end if;

  begin
    v_title  := btrim(coalesce(p_item->>'title', ''));
    v_cat    := public._budget_clean_cat(p_item->>'category');
    v_qty    := round((p_item->>'quantity')::numeric, 2);
    v_price  := round((p_item->>'unit_price')::numeric, 2);
    v_status := coalesce(p_item->>'status', 'planned');
    v_paid   := round(coalesce(nullif(p_item->>'amount_paid','')::numeric, 0), 2);
    v_vendor := nullif(btrim(coalesce(p_item->>'vendor','')), '');
    v_date   := nullif(p_item->>'payment_date','')::date;
    v_notes  := nullif(btrim(coalesce(p_item->>'notes','')), '');
    v_rpath  := nullif(p_item->>'receipt_path','');
    v_rname  := nullif(left(btrim(coalesce(p_item->>'receipt_name','')), 160), '');
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Numbers or date are not valid');
  end;

  if v_title = '' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Enter an expense name'); end if;
  if v_cat = '' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Choose a category'); end if;
  if char_length(v_cat) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Category name can be up to 60 characters'); end if;
  if v_cat ~* '^others?(\s*/\s*custom( category)?)?$' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Use a specific category name'); end if;
  if v_qty is null or v_qty <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Quantity must be more than 0'); end if;
  if v_price is null or v_price < 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Unit price cannot be negative'); end if;
  if v_status not in ('planned','pending','partially_paid','paid') then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Unknown payment status'); end if;
  v_total := round(v_qty * v_price, 2);
  if v_paid < 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Amount paid cannot be negative'); end if;
  if v_status = 'paid' then v_paid := v_total; end if;
  if v_status in ('planned','pending') then v_paid := 0; end if;
  if v_status = 'partially_paid' and (v_paid <= 0 or v_paid >= v_total) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Partly paid needs an amount between ₹0 and the total'); end if;

  -- category: reuse an existing one (case / spacing-insensitive) or create it (admins and editors)
  select name into v_found from public.budget_categories
   where budget_id = bid and lower(public._budget_clean_cat(name)) = lower(v_cat);
  if found then
    v_cat := v_found;
  else
    if (select count(*) from public.budget_categories where budget_id = bid) >= 300 then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Too many categories — ask an admin to tidy up'); end if;
    insert into public.budget_categories (budget_id, name) values (bid, v_cat)
      on conflict do nothing;
    select name into v_cat from public.budget_categories
     where budget_id = bid and lower(public._budget_clean_cat(name)) = lower(v_cat);
    perform public._budget_log(ctx, null, null, 'category_added', jsonb_build_object('name', v_cat), p_actor_name);
  end if;

  v_id := nullif(p_item->>'id','')::uuid;
  if v_id is not null then
    select * into old from public.budget_items where id = v_id and budget_id = bid for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if p_expected_version is null or old.version <> p_expected_version then
      return jsonb_build_object('ok', false, 'error', 'conflict', 'item', public._budget_item_json(old)); end if;
  end if;

  -- receipt: unchanged ('keep'), cleared (null) or a freshly uploaded object under this budget/item
  if (p_item->>'receipt_path') = 'keep' then
    v_rpath := case when v_id is not null then old.receipt_path end;
    v_rname := case when v_id is not null then old.receipt_name end;
  elsif v_rpath is not null then
    if v_id is null or v_rpath not like bid::text || '/' || v_id::text || '/%'
       or not exists (select 1 from storage.objects where bucket_id = 'budget-receipts' and name = v_rpath) then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Receipt upload not found'); end if;
  end if;

  if v_id is null then
    insert into public.budget_items (budget_id, title, category, quantity, unit_price, status, amount_paid,
                                     vendor, payment_date, notes, client_request_id, created_by_label, updated_by_label)
    values (bid, v_title, v_cat, v_qty, v_price, v_status, v_paid, v_vendor, v_date, v_notes,
            p_client_request_id, label, label)
    returning * into rec;
    perform public._budget_log(ctx, rec.id, rec.title, 'created',
      jsonb_build_object('after', jsonb_build_object('category', rec.category, 'quantity', rec.quantity,
        'unit_price', rec.unit_price, 'line_total', rec.line_total, 'status', rec.status, 'amount_paid', rec.amount_paid)), p_actor_name);
  else
    update public.budget_items set title = v_title, category = v_cat, quantity = v_qty, unit_price = v_price,
           status = v_status, amount_paid = v_paid, vendor = v_vendor, payment_date = v_date, notes = v_notes,
           receipt_path = v_rpath, receipt_name = case when v_rpath is null then null else v_rname end,
           version = version + 1, updated_at = now(), updated_by_label = label
     where id = v_id returning * into rec;
    foreach k in array array['title','category','quantity','unit_price','line_total','status','amount_paid','vendor','payment_date','notes','receipt_name'] loop
      if (to_jsonb(old)->k) is distinct from (to_jsonb(rec)->k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old)->k, 'to', to_jsonb(rec)->k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then perform public._budget_log(ctx, rec.id, rec.title, 'updated', diff, p_actor_name); end if;
  end if;
  return jsonb_build_object('ok', true, 'item', public._budget_item_json(rec));
exception
  when unique_violation then
    select * into rec from public.budget_items where client_request_id = p_client_request_id;
    if found and rec.budget_id = bid then return jsonb_build_object('ok', true, 'duplicate', true, 'item', public._budget_item_json(rec)); end if;
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Could not save');
  when check_violation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Amounts are out of range');
end $$;

create or replace function public.budget_admin_add_category(p_budget uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(null, null, p_budget); v text := public._budget_clean_cat(p_name); rec public.budget_categories;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  if v = '' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Enter a category name'); end if;
  if char_length(v) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Category name can be up to 60 characters'); end if;
  select * into rec from public.budget_categories
   where budget_id = (ctx->>'budget_id')::uuid and lower(public._budget_clean_cat(name)) = lower(v);
  if found then return jsonb_build_object('ok', true, 'category', jsonb_build_object('id', rec.id, 'name', rec.name)); end if;
  insert into public.budget_categories (budget_id, name) values ((ctx->>'budget_id')::uuid, v) returning * into rec;
  perform public._budget_log(ctx, null, null, 'category_added', jsonb_build_object('name', v), null);
  return jsonb_build_object('ok', true, 'category', jsonb_build_object('id', rec.id, 'name', rec.name));
end $$;

create or replace function public.budget_admin_rename_category(p_category uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec public.budget_categories; ctx jsonb; v text := public._budget_clean_cat(p_name); n int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;
  if v = '' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Enter a category name'); end if;
  if char_length(v) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Category name can be up to 60 characters'); end if;
  select * into rec from public.budget_categories where id = p_category for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from public.budget_categories where budget_id = rec.budget_id and id <> rec.id
               and lower(public._budget_clean_cat(name)) = lower(v)) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'A category with that name already exists'); end if;
  ctx := public._budget_resolve(null, null, rec.budget_id);
  update public.budget_items set category = v, version = version + 1, updated_at = now()
   where budget_id = rec.budget_id and lower(public._budget_clean_cat(category)) = lower(public._budget_clean_cat(rec.name));
  get diagnostics n = row_count;
  update public.budget_categories set name = v where id = rec.id;
  perform public._budget_log(ctx, null, null, 'category_renamed', jsonb_build_object('from', rec.name, 'to', v, 'items', n), null);
  return jsonb_build_object('ok', true, 'name', v, 'items', n);
end $$;

revoke all on function public.budget_admin_rename_category(uuid, text) from public;
grant execute on function public.budget_admin_rename_category(uuid, text) to authenticated;
