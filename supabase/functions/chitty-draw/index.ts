// ANGLE FRAMES CHITTY — live draw from the Google Sheet (Deno edge function).
//
// Google Sheet (authoritative participants + existing WINNER marks)
//   → validate rows → separate ₹1,000 (A/B) and ₹3,000 (C/D)
//   → exclude sheet winners + winners recorded in chitty_draws
//   → eligible pool → crypto-secure selection under a per-category lock
//   → record once in chitty_draws → write "WINNER" back to the sheet.
//
// POST JSON { action: "pool" | "draw" | "history" | "sync", category?, requestId? }
// Authorization: Bearer <Supabase access token of a website admin (public.is_admin())>.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPool, CATEGORIES, CategoryKey, poolFingerprint, secureIndex, slotView, WINNER_MARK } from "./sheet.ts";
import { readRange, SheetError, writeCell } from "./google.ts";

const SHEET_ID = Deno.env.get("CHITTY_SHEET_ID") ?? "11mFrRGIRKFc7Z5wSaB9wK_XkYqhb69v_eEPXokTbOf4";
const SHEET_TAB = Deno.env.get("CHITTY_SHEET_TAB") ?? "Sheet1";
const HEADER_ROWS = Number(Deno.env.get("CHITTY_HEADER_ROWS") ?? "0");
const READ_RANGE = "A1:D2000";
const LOCK_SECONDS = 60;
const RATE = { pool: 40, draw: 8, history: 40, sync: 10 } as Record<string, number>; // per admin per minute
const ALLOWED_ORIGINS = (Deno.env.get("CHITTY_DRAW_ORIGINS") ??
  "https://angleframes.github.io,https://sharankrishnashortfilmawards.com,https://www.sharankrishnashortfilmawards.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = "error") { super(message); }
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function requireAdmin(req: Request): Promise<{ id: string; email: string | null }> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "Admin sign-in required.", "unauthorized");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Your admin session has expired. Sign in again.", "unauthorized");
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: ok, error: e2 } = await asUser.rpc("is_admin");
  if (e2 || ok !== true) throw new HttpError(403, "This account is not an administrator.", "forbidden");
  return { id: data.user.id, email: data.user.email ?? null };
}

async function log(admin: { id: string; email: string | null } | null, action: string, outcome: string, category: string | null, detail: unknown) {
  await db.from("chitty_draw_events").insert({
    admin_user_id: admin?.id ?? null, admin_email: admin?.email ?? null, action, outcome, category, detail,
  });
}

async function rateLimit(admin: { id: string }, action: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("chitty_draw_events").select("id", { count: "exact", head: true })
    .eq("admin_user_id", admin.id).eq("action", action).gte("at", since);
  if ((count ?? 0) >= (RATE[action] ?? 20)) throw new HttpError(429, "Too many requests. Wait a minute and try again.", "rate_limited");
}

async function recordedWinners(category?: CategoryKey) {
  let q = db.from("chitty_draws").select("category, name_cell, participant_name").eq("sheet_id", SHEET_ID);
  if (category) q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw new HttpError(500, "Winner history could not be loaded. No draw was made.");
  return data ?? [];
}

const recordedFor = (rows: { category: string; name_cell: string; participant_name: string }[], key: string) =>
  rows.filter((r) => r.category === key).map((r) => ({ nameCell: r.name_cell, name: r.participant_name }));

/** Fresh sheet read + both category pools. Throws SheetError if the sheet is unavailable. */
async function loadPools() {
  const [rows, recorded] = await Promise.all([readRange(SHEET_ID, SHEET_TAB, READ_RANGE), recordedWinners()]);
  return (Object.keys(CATEGORIES) as CategoryKey[]).map((k) =>
    buildPool(rows, CATEGORIES[k], recordedFor(recorded, k), HEADER_ROWS));
}

const poolView = (p: ReturnType<typeof buildPool>) => ({
  key: p.key, label: p.label, amount: p.amount,
  total: p.total,
  winnersInSheet: p.sheetWinners.length,
  winnersRecordedOnly: p.recordedWinners.length,
  eligibleCount: p.eligible.length,
  eligible: p.eligible.map(slotView),
  winners: [...p.sheetWinners, ...p.recordedWinners].map(slotView),
  flags: p.flags,
  duplicateNames: p.duplicateNames,
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function actionPool() {
  const pools = await loadPools();
  return { sheet: { id: SHEET_ID, tab: SHEET_TAB }, fetchedAt: new Date().toISOString(), categories: pools.map(poolView) };
}

async function actionHistory() {
  const { data, error } = await db.from("chitty_draws")
    .select("draw_id, category, participant_name, name_cell, status_cell, sheet_row, drawn_at, admin_email, eligible_count, sheet_status, sheet_error")
    .eq("sheet_id", SHEET_ID).order("drawn_at", { ascending: false }).limit(500);
  if (error) throw new HttpError(500, "Winner history could not be loaded.");
  return { draws: data };
}

/** Writes WINNER to the status cell only if that row still holds the same person and is still blank. */
async function writeBack(draw: { draw_id: string; sheet_row: number; status_cell: string; participant_name: string; category: string }) {
  const cfg = CATEGORIES[draw.category as CategoryKey];
  try {
    const [row] = await readRange(SHEET_ID, SHEET_TAB, `${cfg.nameCol}${draw.sheet_row}:${cfg.statusCol}${draw.sheet_row}`);
    const name = String(row?.[0] ?? "").replace(/\s+/g, " ").trim();
    const status = String(row?.[1] ?? "").trim();
    if (name.toLowerCase() !== draw.participant_name.toLowerCase()) {
      throw new SheetError(`Row ${draw.sheet_row} changed in the sheet before WINNER could be written (now "${name}"). Please check it.`);
    }
    if (status.toUpperCase() !== WINNER_MARK) {
      if (status) throw new SheetError(`${draw.status_cell} is not blank ("${status}"), so WINNER was not written. Please check it.`);
      await writeCell(SHEET_ID, SHEET_TAB, draw.status_cell, WINNER_MARK);
    }
    await db.from("chitty_draws").update({ sheet_status: "written", sheet_written_at: new Date().toISOString(), sheet_error: null }).eq("draw_id", draw.draw_id);
    return { sheetStatus: "written" as const, sheetError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("chitty_draws").update({ sheet_status: "failed", sheet_error: msg }).eq("draw_id", draw.draw_id);
    return { sheetStatus: "failed" as const, sheetError: msg };
  }
}

async function actionDraw(admin: { id: string; email: string | null }, category: CategoryKey, requestId: string) {
  // Idempotent: a retried request returns the draw it already made.
  const { data: prior } = await db.from("chitty_draws").select("*").eq("request_id", requestId).maybeSingle();
  if (prior) return { replay: true, ...(await drawResponse(prior, null, null)) };

  const holder = crypto.randomUUID();
  const { data: locked, error: lockErr } = await db.rpc("chitty_acquire_lock", { p_category: category, p_holder: holder, p_seconds: LOCK_SECONDS });
  if (lockErr) throw new HttpError(500, "The draw lock could not be checked. No draw was made.");
  if (locked !== true) throw new HttpError(409, "Another draw for this chitty is already in progress. Wait for it to finish.", "busy");

  try {
    // Always a fresh read immediately before the draw — never cached data.
    const [rows, recorded] = await Promise.all([readRange(SHEET_ID, SHEET_TAB, READ_RANGE), recordedWinners(category)]);
    const pool = buildPool(rows, CATEGORIES[category], recordedFor(recorded, category), HEADER_ROWS);
    if (!pool.eligible.length) throw new HttpError(409, `No eligible participants left in the ${pool.label}.`, "empty");

    const index = secureIndex(pool.eligible.length);
    const winner = pool.eligible[index];
    const fingerprint = await poolFingerprint(pool.eligible);

    const { data: draw, error } = await db.from("chitty_draws").insert({
      request_id: requestId, category, sheet_id: SHEET_ID, sheet_tab: SHEET_TAB,
      sheet_row: winner.row, name_cell: winner.nameCell, status_cell: winner.statusCell,
      participant_name: winner.name, eligible_count: pool.eligible.length, pool_sha256: fingerprint,
      admin_user_id: admin.id, admin_email: admin.email,
    }).select("*").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new HttpError(409, "This participant is already recorded as a winner. No duplicate was created.", "duplicate");
      throw new HttpError(500, "The winner could not be saved. No draw was made.");
    }

    const sheet = await writeBack(draw);
    await log(admin, "draw", "ok", category, {
      draw_id: draw.draw_id, cell: winner.nameCell, name: winner.name, eligible: pool.eligible.length, pool_sha256: fingerprint, sheet: sheet.sheetStatus,
    });
    return drawResponse({ ...draw, sheet_status: sheet.sheetStatus, sheet_error: sheet.sheetError }, pool.eligible.map(slotView), index);
  } finally {
    await db.rpc("chitty_release_lock", { p_category: category, p_holder: holder });
  }
}

function drawResponse(draw: any, pool: ReturnType<typeof slotView>[] | null, index: number | null) {
  return {
    draw: {
      drawId: draw.draw_id, category: draw.category, label: CATEGORIES[draw.category as CategoryKey].label,
      name: draw.participant_name, cell: draw.name_cell, row: draw.sheet_row, drawnAt: draw.drawn_at,
      eligibleCount: draw.eligible_count, poolSha256: draw.pool_sha256, admin: draw.admin_email,
      sheetStatus: draw.sheet_status, sheetError: draw.sheet_error,
    },
    pool, winnerIndex: index,
  };
}

async function actionSync(admin: { id: string; email: string | null }) {
  const { data } = await db.from("chitty_draws").select("*").eq("sheet_id", SHEET_ID).in("sheet_status", ["pending", "failed"]);
  const results = [];
  for (const d of data ?? []) results.push({ drawId: d.draw_id, cell: d.status_cell, ...(await writeBack(d)) });
  await log(admin, "sync", "ok", null, { results });
  return { results };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(req, { error: "Origin not allowed" }, 403);

  let admin: { id: string; email: string | null } | null = null;
  let action = "unknown";
  let category: CategoryKey | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    action = String(body.action ?? "");
    admin = await requireAdmin(req);
    if (!["pool", "draw", "history", "sync"].includes(action)) throw new HttpError(400, "Unknown action.");
    await rateLimit(admin, action);

    if (action === "pool") {
      const out = await actionPool();
      await log(admin, "pool", "ok", null, { counts: out.categories.map((c) => ({ key: c.key, eligible: c.eligibleCount, total: c.total })) });
      return json(req, out);
    }
    if (action === "history") return json(req, await actionHistory());
    if (action === "sync") return json(req, await actionSync(admin));

    category = String(body.category ?? "") as CategoryKey;
    if (!(category in CATEGORIES)) throw new HttpError(400, "Choose the ₹1,000 or ₹3,000 chitty.");
    const requestId = String(body.requestId ?? "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new HttpError(400, "Missing draw request id.");
    return json(req, await actionDraw(admin, category, requestId));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof SheetError ? e.status : 500;
    const message = e instanceof HttpError || e instanceof SheetError ? e.message : "Something went wrong. No draw was made.";
    const code = e instanceof HttpError ? e.code : e instanceof SheetError ? "sheet_unavailable" : "error";
    if (!(e instanceof HttpError || e instanceof SheetError)) console.error(e);
    if (admin) { // audit authenticated admins only, so anonymous traffic cannot flood the log
      try { await log(admin, action, code, category, { status, message }); } catch { /* logging must not mask the error */ }
    }
    return json(req, { error: message, code }, status);
  }
});
