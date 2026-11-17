-- Event Budget & Expense Management (Sharankrishna Short Film Awards)
-- Separate from film registration / payment data. All writes go through SECURITY DEFINER RPCs:
--   * admins     → auth session + public.is_admin()
--   * share links → 192-bit random token, only its SHA-256 stored; optional bcrypt passcode,
--                   expiry, instant revoke, passcode lockout.
-- Tables have RLS on; anon/authenticated get NO direct table access except admin SELECT.

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.budgets (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  allocated_budget numeric(14,2) check (allocated_budget is null or allocated_budget >= 0),
  currency         text not null default 'INR' check (currency = 'INR'),
  is_default       boolean not null default false,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists budgets_one_default on public.budgets (is_default) where is_default;

create table if not exists public.budget_categories (
  id         uuid primary key default gen_random_uuid(),
  budget_id  uuid not null references public.budgets(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  sort       int  not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists budget_categories_name_uq on public.budget_categories (budget_id, lower(btrim(name)));

create table if not exists public.budget_items (
  id                uuid primary key default gen_random_uuid(),
  budget_id         uuid not null references public.budgets(id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 160),
  category          text not null check (char_length(btrim(category)) between 1 and 60),
  quantity          numeric(12,2) not null check (quantity > 0 and quantity <= 1000000),
  unit_price        numeric(14,2) not null check (unit_price >= 0 and unit_price <= 1000000000),
  line_total        numeric(16,2) generated always as (round(quantity * unit_price, 2)) stored,
  status            text not null default 'planned' check (status in ('planned','pending','partially_paid','paid')),
  amount_paid       numeric(16,2) not null default 0 check (amount_paid >= 0),
  vendor            text check (vendor is null or char_length(vendor) <= 120),
  payment_date      date,
  notes             text check (notes is null or char_length(notes) <= 2000),
  receipt_path      text check (receipt_path is null or char_length(receipt_path) <= 300),
  receipt_name      text check (receipt_name is null or char_length(receipt_name) <= 160),
  version           int  not null default 1,
  client_request_id uuid unique,
  created_by_label  text,
  updated_by_label  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint budget_items_paid_le_total check (amount_paid <= round(quantity * unit_price, 2)),
  constraint budget_items_status_paid check (
        (status in ('planned','pending') and amount_paid = 0)
     or (status = 'partially_paid' and amount_paid > 0 and amount_paid < round(quantity * unit_price, 2))
     or (status = 'paid' and amount_paid = round(quantity * unit_price, 2)))
);
create index if not exists budget_items_budget_idx on public.budget_items (budget_id, created_at);

create table if not exists public.budget_share_links (
  id              uuid primary key default gen_random_uuid(),
  budget_id       uuid not null references public.budgets(id) on delete cascade,
  role            text not null check (role in ('viewer','editor')),
  label           text check (label is null or char_length(label) <= 80),
  token_hash      text not null unique,          -- sha256 hex of the token; the token itself is never stored
  token_hint      text,                          -- last 4 chars, to tell links apart
  passcode_hash   text,                          -- bcrypt
  expires_at      timestamptz,
  revoked_at      timestamptz,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  last_used_at    timestamptz,
  use_count       int not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists budget_share_links_budget_idx on public.budget_share_links (budget_id);

create table if not exists public.budget_activity (
  id           bigint generated always as identity primary key,
  budget_id    uuid not null references public.budgets(id) on delete cascade,
  item_id      uuid,
  item_title   text,
  action       text not null,
  changes      jsonb,
  actor_type   text not null check (actor_type in ('admin','link')),
  actor_user   uuid,
  actor_email  text,
  link_id      uuid,
  link_label   text,
  link_role    text,
  display_name text,                              -- typed by the collaborator; NOT verified
  created_at   timestamptz not null default now()
);
create index if not exists budget_activity_budget_idx on public.budget_activity (budget_id, created_at desc);

-- ───────────────────────── RLS ─────────────────────────
alter table public.budgets            enable row level security;
alter table public.budget_categories  enable row level security;
alter table public.budget_items       enable row level security;
alter table public.budget_share_links enable row level security;
alter table public.budget_activity    enable row level security;

revoke all on public.budgets, public.budget_categories, public.budget_items,
              public.budget_share_links, public.budget_activity from anon, authenticated;
grant select on public.budgets, public.budget_categories, public.budget_items,
                public.budget_activity to authenticated;   -- share links: RPC only (hashes never leave the DB)

create policy budgets_admin_read            on public.budgets            for select to authenticated using (public.is_admin());
create policy budget_categories_admin_read  on public.budget_categories  for select to authenticated using (public.is_admin());
create policy budget_items_admin_read       on public.budget_items       for select to authenticated using (public.is_admin());
create policy budget_activity_admin_read    on public.budget_activity    for select to authenticated using (public.is_admin());

-- ───────────────────────── helpers (internal) ─────────────────────────
create or replace function public._budget_ping(p_budget uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- content-free "something changed" broadcast; clients re-fetch through the RPCs
  perform realtime.send(jsonb_build_object('at', now()), 'changed', 'budget-' || p_budget::text, false);
exception when others then null;   -- realtime must never block a save
end $$;

create or replace function public._budget_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._budget_ping(coalesce(new.budget_id, old.budget_id));
  return null;
end $$;

create or replace function public._budget_touch_budget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._budget_ping(coalesce(new.id, old.id));
  return null;
end $$;

drop trigger if exists budget_items_ping on public.budget_items;
create trigger budget_items_ping after insert or update or delete on public.budget_items
  for each row execute function public._budget_touch();
drop trigger if exists budget_categories_ping on public.budget_categories;
create trigger budget_categories_ping after insert or update or delete on public.budget_categories
  for each row execute function public._budget_touch();
drop trigger if exists budgets_ping on public.budgets;
create trigger budgets_ping after update on public.budgets
  for each row execute function public._budget_touch_budget();

-- Resolve who is calling. Token path → share link; no token → must be an admin session.
-- Returns {ok, budget_id, role, link_id, link_label, user_id, email} or {ok:false, error}.
create or replace function public._budget_resolve(p_token text, p_passcode text, p_budget uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l public.budget_share_links; b uuid;
begin
  if p_token is null or p_token = '' then
    if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;
    b := coalesce(p_budget, (select id from public.budgets where is_default limit 1));
    if b is null or not exists (select 1 from public.budgets where id = b) then
      return jsonb_build_object('ok', false, 'error', 'no_budget'); end if;
    return jsonb_build_object('ok', true, 'budget_id', b, 'role', 'admin',
      'user_id', auth.uid(), 'email', (select email from auth.users where id = auth.uid()));
  end if;

  if char_length(p_token) > 100 then return jsonb_build_object('ok', false, 'error', 'link_invalid'); end if;
  select * into l from public.budget_share_links
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'error', 'link_invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'link_revoked'); end if;
  if l.expires_at is not null and l.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'link_expired'); end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', l.locked_until); end if;
  if l.passcode_hash is not null then
    if p_passcode is null or p_passcode = '' then
      return jsonb_build_object('ok', false, 'error', 'passcode_required'); end if;
    if extensions.crypt(left(p_passcode, 72), l.passcode_hash) <> l.passcode_hash then
      update public.budget_share_links
         set failed_attempts = failed_attempts + 1,
             locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
       where id = l.id;
      return jsonb_build_object('ok', false, 'error', 'passcode_wrong');
    end if;
    if l.failed_attempts > 0 then update public.budget_share_links set failed_attempts = 0, locked_until = null where id = l.id; end if;
  end if;
  return jsonb_build_object('ok', true, 'budget_id', l.budget_id, 'role', l.role,
    'link_id', l.id, 'link_label', l.label, 'expires_at', l.expires_at);
end $$;

create or replace function public._budget_log(ctx jsonb, p_item uuid, p_title text, p_action text, p_changes jsonb, p_name text)
returns void language sql security definer set search_path = public as $$
  insert into public.budget_activity (budget_id, item_id, item_title, action, changes, actor_type,
         actor_user, actor_email, link_id, link_label, link_role, display_name)
  values ((ctx->>'budget_id')::uuid, p_item, p_title, p_action, p_changes,
          case when ctx->>'role' = 'admin' then 'admin' else 'link' end,
          nullif(ctx->>'user_id','')::uuid, ctx->>'email',
          nullif(ctx->>'link_id','')::uuid, ctx->>'link_label',
          case when ctx->>'role' = 'admin' then null else ctx->>'role' end,
          nullif(left(btrim(coalesce(p_name,'')), 60), ''));
$$;

create or replace function public._budget_item_json(i public.budget_items) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'category', i.category,
    'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total,
    'status', i.status, 'amount_paid', i.amount_paid, 'vendor', i.vendor,
    'payment_date', i.payment_date, 'notes', i.notes, 'has_receipt', i.receipt_path is not null,
    'receipt_name', i.receipt_name, 'version', i.version,
    'created_by_label', i.created_by_label, 'updated_by_label', i.updated_by_label,
    'created_at', i.created_at, 'updated_at', i.updated_at);
$$;

create or replace function public._budget_actor_label(ctx jsonb, p_name text) returns text
language sql immutable as $$
  select left(case when ctx->>'role' = 'admin' then coalesce(ctx->>'email', 'Admin')
              else coalesce(nullif(btrim(coalesce(p_name,'')),'') || ' (via ', '(') ||
                   coalesce(ctx->>'link_label', initcap(ctx->>'role') || ' link') || ')' end, 120);
$$;

revoke all on function public._budget_ping(uuid), public._budget_touch(), public._budget_touch_budget(),
  public._budget_resolve(text,text,uuid), public._budget_log(jsonb,uuid,text,text,jsonb,text),
  public._budget_item_json(public.budget_items), public._budget_actor_label(jsonb,text) from public, anon, authenticated;

-- ───────────────────────── public RPCs (token or admin) ─────────────────────────
-- What the caller may do; used by the budget-receipt edge function too.
create or replace function public.budget_access(p_token text default null, p_passcode text default null, p_budget uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(p_token, p_passcode, p_budget);
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  return jsonb_build_object('ok', true, 'budget_id', ctx->>'budget_id', 'role', ctx->>'role');
end $$;

create or replace function public.budget_load(p_token text default null, p_passcode text default null, p_budget uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(p_token, p_passcode, p_budget); b public.budgets; bid uuid;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  bid := (ctx->>'budget_id')::uuid;
  select * into b from public.budgets where id = bid;
  if ctx ? 'link_id' then
    update public.budget_share_links set last_used_at = now(), use_count = use_count + 1
     where id = (ctx->>'link_id')::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute');
  end if;
  return jsonb_build_object(
    'ok', true, 'role', ctx->>'role', 'server_time', now(),
    'link', case when ctx ? 'link_id' then jsonb_build_object('label', ctx->>'link_label', 'expires_at', ctx->'expires_at') end,
    'budget', jsonb_build_object('id', b.id, 'title', b.title, 'allocated_budget', b.allocated_budget, 'updated_at', b.updated_at),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, lower(c.name))
                              from public.budget_categories c where c.budget_id = bid), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(public._budget_item_json(i) order by i.created_at, i.id)
                         from public.budget_items i where i.budget_id = bid), '[]'::jsonb),
    'totals', (select jsonb_build_object('total', coalesce(sum(line_total),0), 'paid', coalesce(sum(amount_paid),0),
                       'outstanding', coalesce(sum(line_total - amount_paid),0), 'count', count(*))
                 from public.budget_items where budget_id = bid));
end $$;

-- Create (p_item.id absent) or update (p_item.id + p_expected_version) one expense.
create or replace function public.budget_save_item(
  p_item jsonb, p_token text default null, p_passcode text default null, p_budget uuid default null,
  p_client_request_id uuid default null, p_expected_version int default null, p_actor_name text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  ctx jsonb := public._budget_resolve(p_token, p_passcode, p_budget);
  bid uuid; old public.budget_items; rec public.budget_items; v_id uuid;
  v_title text; v_cat text; v_qty numeric; v_price numeric; v_status text; v_paid numeric; v_total numeric;
  v_vendor text; v_date date; v_notes text; v_rpath text; v_rname text; label text; diff jsonb := '{}'::jsonb; k text;
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
    v_cat    := btrim(coalesce(p_item->>'category', ''));
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
  if v_qty is null or v_qty <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Quantity must be more than 0'); end if;
  if v_price is null or v_price < 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Unit price cannot be negative'); end if;
  if v_status not in ('planned','pending','partially_paid','paid') then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Unknown payment status'); end if;
  v_total := round(v_qty * v_price, 2);
  if v_paid < 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Amount paid cannot be negative'); end if;
  if v_status = 'paid' then v_paid := v_total; end if;
  if v_status in ('planned','pending') then v_paid := 0; end if;
  if v_status = 'partially_paid' and (v_paid <= 0 or v_paid >= v_total) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Partly paid needs an amount between ₹0 and the total'); end if;

  -- category: must exist; admins may add a new one on the fly
  if not exists (select 1 from public.budget_categories where budget_id = bid and lower(btrim(name)) = lower(v_cat)) then
    if ctx->>'role' <> 'admin' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Unknown category'); end if;
    insert into public.budget_categories (budget_id, name) values (bid, left(v_cat, 60));
  else
    select name into v_cat from public.budget_categories where budget_id = bid and lower(btrim(name)) = lower(v_cat);
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

-- ───────────────────────── admin-only RPCs ─────────────────────────
create or replace function public.budget_admin_delete_item(p_item uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(null, null, null); old public.budget_items;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;
  select * into old from public.budget_items where id = p_item for update;
  if not found then return jsonb_build_object('ok', true, 'gone', true); end if;
  if p_expected_version is not null and old.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'item', public._budget_item_json(old)); end if;
  ctx := jsonb_set(ctx, '{budget_id}', to_jsonb(old.budget_id::text));
  delete from public.budget_items where id = p_item;
  perform public._budget_log(ctx, old.id, old.title, 'deleted',
    jsonb_build_object('before', jsonb_build_object('category', old.category, 'quantity', old.quantity, 'unit_price', old.unit_price,
      'line_total', old.line_total, 'status', old.status, 'amount_paid', old.amount_paid, 'vendor', old.vendor)), null);
  return jsonb_build_object('ok', true, 'receipt_path', old.receipt_path);
end $$;

create or replace function public.budget_admin_update_budget(p_budget uuid, p_title text, p_allocated numeric, p_clear_allocated boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(null, null, p_budget); old public.budgets; rec public.budgets; diff jsonb := '{}'::jsonb;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  if p_allocated is not null and (p_allocated < 0 or p_allocated > 100000000000) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Budget must be a positive amount'); end if;
  select * into old from public.budgets where id = (ctx->>'budget_id')::uuid for update;
  update public.budgets set
     title = coalesce(nullif(left(btrim(coalesce(p_title,'')),120),''), title),
     allocated_budget = case when p_clear_allocated then null else coalesce(round(p_allocated,2), allocated_budget) end,
     updated_at = now()
   where id = old.id returning * into rec;
  if old.title is distinct from rec.title then diff := diff || jsonb_build_object('title', jsonb_build_object('from', old.title, 'to', rec.title)); end if;
  if old.allocated_budget is distinct from rec.allocated_budget then
    diff := diff || jsonb_build_object('allocated_budget', jsonb_build_object('from', old.allocated_budget, 'to', rec.allocated_budget)); end if;
  if diff <> '{}'::jsonb then perform public._budget_log(ctx, null, null, 'budget_updated', diff, null); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.budget_admin_add_category(p_budget uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(null, null, p_budget); v text := left(btrim(coalesce(p_name,'')), 60); rec public.budget_categories;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  if v = '' then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Enter a category name'); end if;
  select * into rec from public.budget_categories where budget_id = (ctx->>'budget_id')::uuid and lower(btrim(name)) = lower(v);
  if found then return jsonb_build_object('ok', true, 'category', jsonb_build_object('id', rec.id, 'name', rec.name)); end if;
  insert into public.budget_categories (budget_id, name) values ((ctx->>'budget_id')::uuid, v) returning * into rec;
  perform public._budget_log(ctx, null, null, 'category_added', jsonb_build_object('name', v), null);
  return jsonb_build_object('ok', true, 'category', jsonb_build_object('id', rec.id, 'name', rec.name));
end $$;

create or replace function public.budget_admin_delete_category(p_category uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec public.budget_categories; ctx jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;
  select * into rec from public.budget_categories where id = p_category;
  if not found then return jsonb_build_object('ok', true); end if;
  if exists (select 1 from public.budget_items where budget_id = rec.budget_id and lower(btrim(category)) = lower(btrim(rec.name))) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'This category is used by expenses'); end if;
  ctx := public._budget_resolve(null, null, rec.budget_id);
  delete from public.budget_categories where id = rec.id;
  perform public._budget_log(ctx, null, null, 'category_removed', jsonb_build_object('name', rec.name), null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.budget_admin_create_link(p_budget uuid, p_role text, p_label text default null,
  p_passcode text default null, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ctx jsonb := public._budget_resolve(null, null, p_budget); tok text; rec public.budget_share_links;
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  if p_role not in ('viewer','editor') then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Choose View only or Can edit'); end if;
  if p_expires_at is not null and p_expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Expiry must be in the future'); end if;
  if p_passcode is not null and p_passcode <> '' and char_length(p_passcode) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Passcode needs at least 4 characters'); end if;
  tok := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');   -- 192 bits, 32 url-safe chars
  insert into public.budget_share_links (budget_id, role, label, token_hash, token_hint, passcode_hash, expires_at, created_by)
  values ((ctx->>'budget_id')::uuid, p_role, nullif(left(btrim(coalesce(p_label,'')),80),''),
          encode(extensions.digest(tok, 'sha256'), 'hex'), right(tok, 4),
          case when coalesce(p_passcode,'') <> '' then extensions.crypt(left(p_passcode,72), extensions.gen_salt('bf', 10)) end,
          p_expires_at, auth.uid())
  returning * into rec;
  perform public._budget_log(ctx, null, null, 'link_created',
    jsonb_build_object('link_id', rec.id, 'role', rec.role, 'label', rec.label, 'expires_at', rec.expires_at, 'passcode', rec.passcode_hash is not null), null);
  return jsonb_build_object('ok', true, 'token', tok, 'link_id', rec.id);
end $$;

create or replace function public.budget_admin_update_link(p_link uuid, p_role text default null, p_label text default null,
  p_expires_at timestamptz default null, p_clear_expiry boolean default false,
  p_passcode text default null, p_clear_passcode boolean default false, p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare old public.budget_share_links; rec public.budget_share_links; ctx jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'not_authorized'); end if;
  select * into old from public.budget_share_links where id = p_link for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_role is not null and p_role not in ('viewer','editor') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if p_passcode is not null and p_passcode <> '' and char_length(p_passcode) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Passcode needs at least 4 characters'); end if;
  update public.budget_share_links set
     role = coalesce(p_role, role),
     label = case when p_label is null then label else nullif(left(btrim(p_label),80),'') end,
     expires_at = case when p_clear_expiry then null else coalesce(p_expires_at, expires_at) end,
     passcode_hash = case when p_clear_passcode then null
                          when coalesce(p_passcode,'') <> '' then extensions.crypt(left(p_passcode,72), extensions.gen_salt('bf', 10))
                          else passcode_hash end,
     failed_attempts = case when p_clear_passcode or coalesce(p_passcode,'') <> '' then 0 else failed_attempts end,
     locked_until    = case when p_clear_passcode or coalesce(p_passcode,'') <> '' then null else locked_until end,
     revoked_at = case when p_revoke then coalesce(revoked_at, now()) else revoked_at end
   where id = p_link returning * into rec;
  ctx := public._budget_resolve(null, null, rec.budget_id);
  perform public._budget_log(ctx, null, null, case when p_revoke then 'link_revoked' else 'link_updated' end,
    jsonb_build_object('link_id', rec.id, 'label', rec.label, 'role', jsonb_build_object('from', old.role, 'to', rec.role),
      'expires_at', rec.expires_at, 'passcode', rec.passcode_hash is not null), null);
  perform public._budget_ping(rec.budget_id);   -- open dashboards on that link re-check access
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.budget_admin_list_links(p_budget uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public._budget_resolve(null, null, p_budget);
begin
  if not (ctx->>'ok')::boolean then return ctx; end if;
  return jsonb_build_object('ok', true, 'links', coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'role', l.role, 'label', l.label, 'token_hint', l.token_hint,
             'has_passcode', l.passcode_hash is not null, 'expires_at', l.expires_at, 'revoked_at', l.revoked_at,
             'last_used_at', l.last_used_at, 'use_count', l.use_count, 'created_at', l.created_at,
             'locked', l.locked_until is not null and l.locked_until > now())
           order by (l.revoked_at is null) desc, l.created_at desc)
      from public.budget_share_links l where l.budget_id = (ctx->>'budget_id')::uuid), '[]'::jsonb));
end $$;

-- ───────────────────────── grants ─────────────────────────
revoke all on function public.budget_access(text,text,uuid), public.budget_load(text,text,uuid),
  public.budget_save_item(jsonb,text,text,uuid,uuid,int,text),
  public.budget_admin_delete_item(uuid,int), public.budget_admin_update_budget(uuid,text,numeric,boolean),
  public.budget_admin_add_category(uuid,text), public.budget_admin_delete_category(uuid),
  public.budget_admin_create_link(uuid,text,text,text,timestamptz),
  public.budget_admin_update_link(uuid,text,text,timestamptz,boolean,text,boolean,boolean),
  public.budget_admin_list_links(uuid) from public;
grant execute on function public.budget_access(text,text,uuid), public.budget_load(text,text,uuid),
  public.budget_save_item(jsonb,text,text,uuid,uuid,int,text) to anon, authenticated;
grant execute on function public.budget_admin_delete_item(uuid,int), public.budget_admin_update_budget(uuid,text,numeric,boolean),
  public.budget_admin_add_category(uuid,text), public.budget_admin_delete_category(uuid),
  public.budget_admin_create_link(uuid,text,text,text,timestamptz),
  public.budget_admin_update_link(uuid,text,text,timestamptz,boolean,text,boolean,boolean),
  public.budget_admin_list_links(uuid) to authenticated;

-- ───────────────────────── private receipts bucket ─────────────────────────
-- No storage policies: nobody reads/writes it directly. The budget-receipt edge function
-- checks access via budget_access() and hands out short-lived signed upload/view URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-receipts', 'budget-receipts', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ───────────────────────── seed: one default budget + suggested categories ─────────────────────────
insert into public.budgets (title, is_default)
select 'Sharankrishna Awards 2026', true
where not exists (select 1 from public.budgets where is_default);

insert into public.budget_categories (budget_id, name, sort)
select b.id, c.name, c.ord
from public.budgets b,
     unnest(array['LED Wall Rental','Stage Setup','Sound and Lighting','Refreshments','Tea and Snacks',
                  'Guest Hospitality','Guest Transportation','Trophies','Mementos','Certificates','Printing',
                  'Photography','Videography','Venue Arrangements','Accommodation','Staff Expenses',
                  'Marketing','Decorations','Miscellaneous']) with ordinality as c(name, ord)
where b.is_default
on conflict do nothing;
