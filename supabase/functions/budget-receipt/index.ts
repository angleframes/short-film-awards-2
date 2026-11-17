// budget-receipt — short-lived signed URLs for the private `budget-receipts` bucket.
// Access is decided by public.budget_access() called AS THE CALLER (admin session or share-link token),
// so this function never widens what the caller may do. Service role is used only to mint signed URLs.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "budget-receipts";
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, error: "invalid" }, 400); }
  const action = String(b.action || "");
  const itemId = String(b.item_id || "");
  const token = b.token ? String(b.token).slice(0, 100) : null;
  const passcode = b.passcode ? String(b.passcode).slice(0, 100) : null;
  const budgetId = b.budget_id && UUID.test(String(b.budget_id)) ? String(b.budget_id) : null;
  if (!UUID.test(itemId) || !["upload", "view"].includes(action)) return json({ ok: false, error: "invalid" }, 400);

  // 1. who is calling — evaluated with the caller's own JWT (anon key or admin session)
  const caller = createClient(URL_, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || `Bearer ${ANON}` } },
    auth: { persistSession: false },
  });
  const { data: acc, error: accErr } = await caller.rpc("budget_access", {
    p_token: token, p_passcode: passcode, p_budget: budgetId,
  });
  if (accErr || !acc?.ok) return json({ ok: false, error: acc?.error || "not_authorized" }, 403);

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const { data: item } = await admin.from("budget_items")
    .select("id, budget_id, receipt_path").eq("id", itemId).maybeSingle();
  if (!item || item.budget_id !== acc.budget_id) return json({ ok: false, error: "not_found" }, 404);

  if (action === "view") {
    if (!item.receipt_path) return json({ ok: false, error: "not_found" }, 404);
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(item.receipt_path, 300);
    if (error || !data) return json({ ok: false, error: "storage" }, 500);
    return json({ ok: true, url: data.signedUrl });
  }

  // upload
  if (acc.role !== "admin" && acc.role !== "editor") return json({ ok: false, error: "read_only" }, 403);
  const ext = TYPES[String(b.type || "")];
  const size = Number(b.size || 0);
  if (!ext) return json({ ok: false, error: "invalid", message: "Use PDF, JPG, PNG or WebP" }, 400);
  if (!(size > 0 && size <= MAX_BYTES)) return json({ ok: false, error: "invalid", message: "File must be under 10 MB" }, 400);
  const path = `${acc.budget_id}/${itemId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return json({ ok: false, error: "storage" }, 500);
  return json({ ok: true, path, token: data.token });
});
