// Sharankrishna Short Film Awards — Cashfree Payment Edge Function v7 (Deno)
// Routes by "action" field in POST body:
//   createOrder   → create Cashfree order, return payment_session_id
//                   (Campus Track: refuses to create an order without a verified student proof)
//   verifyOrder   → server-verify order status from Cashfree
//   saveFormData  → pre-save form data with payment_status='pending' before payment
//   (no action)   → final submission: re-verify PAID, upsert film_entries, send email

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CASHFREE_API_VERSION = "2025-01-01";
const ENV = (Deno.env.get("CASHFREE_ENV") ?? "sandbox").toLowerCase();
const CF_BASE = ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

const ORDER_AMOUNT: number = 1000;
const ORDER_CURRENCY: string = "INR";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://sharankrishnashortfilmawards.com";
const WEBHOOK_URL = Deno.env.get("WEBHOOK_URL") ??
  "https://flwlbraeyyrofkhxnvwt.supabase.co/functions/v1/cashfree-webhook";

const cfHeaders = {
  "x-client-id": Deno.env.get("CASHFREE_APP_ID") ?? "",
  "x-client-secret": Deno.env.get("CASHFREE_SECRET_KEY") ?? "",
  "x-api-version": CASHFREE_API_VERSION,
  "Content-Type": "application/json",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOW_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPUS_PROOF_MISSING =
  "Campus Track entries require a verified student proof document. Please upload it in the Film Details step.";

function isCampus(category: unknown): boolean {
  return String(category ?? "").trim().toLowerCase() === "campus";
}

// A proof is usable if it was accepted by the campus-proof function and is not
// already attached to a PAID entry for a different order.
async function checkCampusProof(proofId: unknown, orderId?: string):
  Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const id = String(proofId ?? "").trim();
  if (!UUID_RE.test(id)) return { ok: false, message: CAMPUS_PROOF_MISSING };
  const { data: proof } = await supabase.from("campus_proof_uploads").select("id").eq("id", id).maybeSingle();
  if (!proof) return { ok: false, message: CAMPUS_PROOF_MISSING };
  const { data: holder } = await supabase
    .from("film_entries")
    .select("id, payment_status, cashfree_order_id")
    .eq("campus_proof_id", id)
    .maybeSingle();
  if (holder && holder.cashfree_order_id !== orderId && holder.payment_status === "Paid") {
    return { ok: false, message: "This verification document is already attached to another entry. Please upload it again for this film." };
  }
  return { ok: true, id };
}

// Moves the proof onto this entry, releasing it from any abandoned (unpaid) checkout.
async function attachCampusProof(entryId: number, proofId: string): Promise<boolean> {
  await supabase.from("film_entries").update({ campus_proof_id: null })
    .eq("campus_proof_id", proofId).neq("id", entryId).neq("payment_status", "Paid");
  const { error } = await supabase.from("film_entries").update({ campus_proof_id: proofId }).eq("id", entryId);
  if (error) console.error("attachCampusProof failed:", error.message);
  return !error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET")
    return json({ status: "success", message: "SKA payment backend live", env: ENV });

  let data: Record<string, unknown> = {};
  try {
    data = await req.json();
  } catch {
    return json({ status: "error", message: "Bad JSON body" }, 400);
  }

  try {
    if (data.action === "createOrder") return json(await createOrder(data));
    if (data.action === "verifyOrder")
      return json(await verifyOrder(String(data.orderId ?? "")));
    if (data.action === "saveFormData") return json(await saveFormData(data));
    return json(await handleSubmission(data));
  } catch (err) {
    console.error("Unhandled error:", (err as Error)?.message);
    return json(
      { status: "error", message: (err as Error)?.message ?? "Internal error" },
      500,
    );
  }
});

async function createOrder(data: Record<string, unknown>) {
  if (!cfHeaders["x-client-id"] || !cfHeaders["x-client-secret"]) {
    return { status: "error", message: "Payment gateway not configured (missing credentials)." };
  }

  const category = String(data.category ?? "").trim();
  if (!category) {
    return { status: "error", message: "Please refresh the page and complete the form again." };
  }
  if (isCampus(category)) {
    const proof = await checkCampusProof(data.campusProofId);
    if (!proof.ok) return { status: "error", message: proof.message };
  }

  const orderId =
    "SKSFA_" + new Date().getFullYear() + "_" +
    Date.now() + "_" + Math.floor(Math.random() * 99999).toString().padStart(5, "0");

  const rawPhone = String(data.customerPhone ?? "").replace(/\D/g, "").slice(-10);
  const phone = rawPhone.length === 10 ? rawPhone : "9999999999";
  const name = String(data.customerName ?? "Applicant").slice(0, 100);
  const email = String(data.customerEmail ?? "").trim() || "noemail@example.com";

  const payload = {
    order_id: orderId,
    order_amount: ORDER_AMOUNT,
    order_currency: ORDER_CURRENCY,
    customer_details: {
      customer_id: "SKSFA_" + phone,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
    },
    order_meta: {
      return_url: SITE_URL + "/?order_id={order_id}&status={order_status}",
      notify_url: WEBHOOK_URL,
    },
    order_note: "Sharankrishna Short Film Awards 2026 — Entry Fee",
    order_tags: { source: "website", festival: "SKSFA2026" },
  };

  console.log("Creating order:", orderId, "amount:", ORDER_AMOUNT, "env:", ENV);

  const r = await fetch(CF_BASE + "/orders", {
    method: "POST",
    headers: cfHeaders,
    body: JSON.stringify(payload),
  });
  const body = await r.json();

  if (!r.ok || !body.payment_session_id) {
    console.error("Cashfree order creation failed:", body.message);
    return {
      status: "error",
      message: body.message || "Cashfree order creation failed. Please retry.",
    };
  }

  return {
    status: "success",
    order_id: body.order_id || orderId,
    payment_session_id: body.payment_session_id,
  };
}

async function verifyOrder(orderId: string) {
  if (!orderId) return { status: "error", message: "Missing orderId" };
  if (!cfHeaders["x-client-id"]) return { status: "error", message: "Payment gateway not configured." };

  const r = await fetch(CF_BASE + "/orders/" + encodeURIComponent(orderId), {
    method: "GET",
    headers: cfHeaders,
  });
  const order = await r.json();

  if (!r.ok || !order.order_status) {
    return { status: "error", message: order.message || "Could not fetch order from Cashfree." };
  }

  if (
    order.order_status === "PAID" &&
    Number(order.order_amount) < ORDER_AMOUNT
  ) {
    console.error("Amount mismatch! Expected", ORDER_AMOUNT, "got", order.order_amount);
    return { status: "error", message: "Payment amount mismatch. Contact support." };
  }

  let cfPaymentId: string | null = null;
  let paidAt: string | null = null;
  let paymentMethod: string | null = null;

  try {
    const pr = await fetch(
      CF_BASE + "/orders/" + encodeURIComponent(orderId) + "/payments",
      { method: "GET", headers: cfHeaders },
    );
    const pays = await pr.json();
    if (Array.isArray(pays) && pays.length > 0) {
      const ok = pays.find((p) => p.payment_status === "SUCCESS") ?? pays[0];
      if (ok) {
        cfPaymentId = String(ok.cf_payment_id ?? "");
        paidAt = ok.payment_time ?? null;
        paymentMethod = ok.payment_group ?? ok.payment_method ?? null;
      }
    }
  } catch (_) {}

  return {
    status: "success",
    order_status: order.order_status,
    order_amount: order.order_amount,
    order_currency: order.order_currency,
    cf_payment_id: cfPaymentId,
    paid_at: paidAt,
    payment_method: paymentMethod,
  };
}

async function saveFormData(data: Record<string, unknown>) {
  const orderId = String(data.cashfreeOrderId ?? "").trim();
  if (!orderId) return { status: "error", message: "Missing cashfreeOrderId." };

  const applicantName = String(data.applicantName ?? "").trim();
  const email = String(data.email ?? "").trim();
  if (!applicantName || !email) {
    return { status: "error", message: "Missing required applicant fields." };
  }

  let campusProofId: string | null = null;
  if (isCampus(data.category)) {
    const proof = await checkCampusProof(data.campusProofId, orderId);
    if (!proof.ok) return { status: "error", message: proof.message };
    campusProofId = proof.id;
  }

  const { data: existing } = await supabase
    .from("film_entries")
    .select("id, payment_status, campus_proof_id")
    .eq("cashfree_order_id", orderId)
    .single();

  if (existing) {
    if (campusProofId && !existing.campus_proof_id) await attachCampusProof(existing.id, campusProofId);
    return { status: "success", entry_id: existing.id, already_saved: true };
  }

  let resolvedLinkId: number | null = null;
  const submittedSource = String(data.source ?? "website");
  const submittedLinkToken = String(data.linkToken ?? "").trim();

  if (submittedLinkToken) {
    const { data: lkData } = await supabase
      .from("submission_links")
      .select("id, revoked, expires_at, max_uses, use_count")
      .eq("token", submittedLinkToken)
      .single();
    if (lkData && !lkData.revoked) {
      const now = new Date();
      const notExpired = !lkData.expires_at || new Date(lkData.expires_at) > now;
      const notExhausted = lkData.max_uses === 0 || lkData.use_count < lkData.max_uses;
      if (notExpired && notExhausted) {
        resolvedLinkId = Number(lkData.id);
      }
    }
  }

  const row = {
    applicant_name: applicantName,
    email: email,
    phone: String(data.phone ?? ""),
    city: String(data.city ?? ""),
    film_name: String(data.filmName ?? ""),
    category: String(data.category ?? ""),
    film_link: String(data.filmLink ?? ""),
    duration: String(data.duration ?? ""),
    director: String(data.director ?? ""),
    producer: String(data.producer ?? ""),
    writer: String(data.writer ?? ""),
    cinematographer: String(data.cinematographer ?? ""),
    editor: String(data.editor ?? ""),
    music_director: String(data.musicDirector ?? ""),
    actor: String(data.actor ?? ""),
    actress: String(data.actress ?? ""),
    child_artist: String(data.childArtist ?? ""),
    payment_status: "pending",
    cashfree_order_id: orderId,
    confirmation_sent: false,
    source: submittedSource,
    link_id: resolvedLinkId,
  };

  const { data: inserted, error } = await supabase
    .from("film_entries")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: "success", message: "Entry already saved.", already_saved: true };
    }
    console.error("saveFormData insert error:", error.message);
    return { status: "error", message: error.message };
  }

  if (campusProofId && inserted?.id) await attachCampusProof(inserted.id, campusProofId);

  console.log("Pre-saved entry", inserted?.id, "for order", orderId, "status=pending");
  return { status: "success", entry_id: inserted?.id };
}

async function handleSubmission(data: Record<string, unknown>) {
  const orderId = String(data.cashfreeOrderId ?? "").trim();
  if (!orderId) return { status: "error", message: "Missing payment reference (cashfreeOrderId)." };

  const check = await verifyOrder(orderId);
  if (check.status !== "success" || String(check.order_status).toUpperCase() !== "PAID") {
    return {
      status: "error",
      message: "Payment not verified for this order. Status: " +
        (check.order_status ?? check.message ?? "unknown"),
    };
  }

  const { data: existing } = await supabase
    .from("film_entries")
    .select("id, payment_status, confirmation_sent, category, campus_proof_id")
    .eq("cashfree_order_id", orderId)
    .single();

  if (existing && existing.payment_status === "Paid") {
    return { status: "success", message: "Entry already registered.", already_registered: true };
  }

  if (existing && existing.payment_status === "pending") {
    const updateFields = {
      payment_status: "Paid",
      cashfree_payment_id: data.cashfreePaymentId || check.cf_payment_id,
      amount: check.order_amount,
      currency: check.order_currency,
      paid_at: check.paid_at,
      payment_method: check.payment_method,
      payment_verified_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("film_entries")
      .update(updateFields)
      .eq("id", existing.id);

    if (upErr) {
      console.error("Update pending→Paid error:", upErr.message);
      return { status: "error", message: upErr.message };
    }

    await incrementLinkUsage(orderId);

    // Payment is already taken, so a missing proof never blocks here; admins see it flagged.
    if (isCampus(existing.category) && !existing.campus_proof_id && data.campusProofId) {
      const proof = await checkCampusProof(data.campusProofId, orderId);
      if (proof.ok) await attachCampusProof(existing.id, proof.id);
    }

    const { data: finalRow } = await supabase
      .from("film_entries")
      .select("*")
      .eq("id", existing.id)
      .single();

    try {
      await sendConfirmationEmail(finalRow || { ...updateFields, cashfree_order_id: orderId });
      await supabase.from("film_entries").update({ confirmation_sent: true }).eq("id", existing.id);
    } catch (emailErr) {
      console.error("Email send failed (non-fatal):", (emailErr as Error)?.message);
    }

    console.log("Finalized pending entry", existing.id, "for order", orderId);
    return { status: "success" };
  }

  let resolvedLinkId: number | null = null;
  const submittedSource = String(data.source ?? "website");
  const submittedLinkToken = String(data.linkToken ?? "").trim();

  if (submittedLinkToken) {
    const { data: lkData } = await supabase
      .from("submission_links")
      .select("id, revoked, expires_at, max_uses, use_count")
      .eq("token", submittedLinkToken)
      .single();
    if (lkData && !lkData.revoked) {
      const now = new Date();
      const notExpired = !lkData.expires_at || new Date(lkData.expires_at) > now;
      const notExhausted = lkData.max_uses === 0 || lkData.use_count < lkData.max_uses;
      if (notExpired && notExhausted) {
        resolvedLinkId = Number(lkData.id);
        supabase
          .from("submission_links")
          .update({ use_count: lkData.use_count + 1 })
          .eq("id", lkData.id)
          .then(() => console.log("Incremented use_count for link", lkData.id))
          .catch((e: Error) => console.warn("Could not increment use_count:", e.message));
      }
    }
  }

  const row = {
    applicant_name: String(data.applicantName ?? ""),
    email: String(data.email ?? ""),
    phone: String(data.phone ?? ""),
    city: String(data.city ?? ""),
    film_name: String(data.filmName ?? ""),
    category: String(data.category ?? ""),
    film_link: String(data.filmLink ?? ""),
    duration: String(data.duration ?? ""),
    director: String(data.director ?? ""),
    producer: String(data.producer ?? ""),
    writer: String(data.writer ?? ""),
    cinematographer: String(data.cinematographer ?? ""),
    editor: String(data.editor ?? ""),
    music_director: String(data.musicDirector ?? ""),
    actor: String(data.actor ?? ""),
    actress: String(data.actress ?? ""),
    child_artist: String(data.childArtist ?? ""),
    payment_status: "Paid",
    cashfree_order_id: orderId,
    cashfree_payment_id: data.cashfreePaymentId || check.cf_payment_id,
    amount: check.order_amount,
    currency: check.order_currency,
    paid_at: check.paid_at,
    payment_method: check.payment_method,
    payment_verified_at: new Date().toISOString(),
    confirmation_sent: false,
    source: submittedSource,
    link_id: resolvedLinkId,
  };

  const { data: inserted, error } = await supabase
    .from("film_entries")
    .insert(row)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: "success", message: "Entry already registered.", already_registered: true };
    }
    console.error("DB insert error:", error.message);
    return { status: "error", message: error.message };
  }

  if (inserted?.id && isCampus(row.category) && data.campusProofId) {
    const proof = await checkCampusProof(data.campusProofId, orderId);
    if (proof.ok) await attachCampusProof(inserted.id, proof.id);
  }

  try {
    await sendConfirmationEmail(inserted || row);
    await supabase
      .from("film_entries")
      .update({ confirmation_sent: true })
      .eq("cashfree_order_id", orderId);
  } catch (emailErr) {
    console.error("Email send failed (non-fatal):", (emailErr as Error)?.message);
  }

  return { status: "success" };
}

async function incrementLinkUsage(orderId: string) {
  try {
    const { data: entry } = await supabase
      .from("film_entries")
      .select("link_id")
      .eq("cashfree_order_id", orderId)
      .single();
    if (!entry?.link_id) return;

    const { data: lk } = await supabase
      .from("submission_links")
      .select("use_count")
      .eq("id", entry.link_id)
      .single();
    if (!lk) return;

    await supabase
      .from("submission_links")
      .update({ use_count: lk.use_count + 1 })
      .eq("id", entry.link_id);
    console.log("Incremented use_count for link", entry.link_id);
  } catch (e) {
    console.warn("Could not increment use_count:", (e as Error).message);
  }
}

async function sendConfirmationEmail(entry: Record<string, unknown>) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoKey) { console.warn("BREVO_API_KEY not set — skipping email"); return; }

  const recipientEmail = String(entry.email ?? "");
  const recipientName = String(entry.applicant_name ?? "Applicant");
  if (!recipientEmail || !recipientEmail.includes("@")) return;

  const invoiceNo = "SKSFA-" + new Date().getFullYear() + "-" +
    String(entry.cashfree_order_id ?? "").slice(-6);
  const invoiceDate = new Date().toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });
  const paidAmount = "₹" + Number(entry.amount || 1000).toLocaleString("en-IN");

  const html = buildEmailHtml({
    recipientName,
    invoiceNo,
    invoiceDate,
    filmName: String(entry.film_name ?? ""),
    category: String(entry.category ?? ""),
    orderId: String(entry.cashfree_order_id ?? ""),
    paymentId: String(entry.cashfree_payment_id ?? ""),
    paymentMethod: String(entry.payment_method ?? "Online Payment"),
    paidAmount,
    email: recipientEmail,
  });

  const payload = {
    sender: { name: "Sharankrishna Short Film Awards", email: Deno.env.get("FROM_EMAIL") ?? "noreply@sharankrishnashortfilmawards.com" },
    to: [{ name: recipientName, email: recipientEmail }],
    subject: "🎬 Entry Confirmed — Sharankrishna Short Film Awards | " + invoiceNo,
    htmlContent: html,
  };

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error("Brevo API error " + resp.status + ": " + await resp.text());
  console.log("Confirmation email sent to", recipientEmail, "for order", entry.cashfree_order_id);
}

function buildEmailHtml(d: { recipientName:string; invoiceNo:string; invoiceDate:string; filmName:string; category:string; orderId:string; paymentId:string; paymentMethod:string; paidAmount:string; email:string; }) {
  const e = escHtml;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Entry Confirmed</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#1a0a2e 0%,#0d1a2e 50%,#1a0a2e 100%);border-radius:16px 16px 0 0;padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(212,175,55,0.3);">
<span style="font-size:36px;">🎬</span>
<p style="margin:16px 0 8px;color:#d4af37;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Sharankrishna Short Film Awards</p>
<h1 style="margin:0 0 12px;color:#ffffff;font-size:28px;font-weight:700;">Congratulations!</h1>
<h2 style="margin:0 0 20px;color:#e8d5a3;font-size:18px;font-weight:400;">Your festival entry has been received</h2>
<p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;">Thank you for participating in the Sharankrishna Short Film Awards.<br>We appreciate your passion for cinema and wish you the very best.</p>
</td></tr>
<tr><td style="background:#12121f;padding:32px 40px;">
<p style="margin:0 0 8px;color:#d4af37;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Film Entry</p>
<h3 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:700;">${e(d.filmName)}</h3>
<p style="margin:0 0 24px;color:#a0a0c0;font-size:14px;">Category: ${e(d.category)}</p>
<p style="margin:0;color:#c0c0d8;font-size:14px;line-height:1.7;">Dear ${e(d.recipientName)},<br><br>Your payment was successful and your entry has been officially registered. You will receive further communications at this email address regarding screening schedules and the awards ceremony.</p>
</td></tr>
<tr><td style="background:#0f0f1e;padding:24px 40px 32px;">
<p style="margin:0 0 16px;color:#d4af37;font-size:10px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Payment Invoice — ${e(d.invoiceNo)}</p>
<table width="100%" cellpadding="12" cellspacing="0" style="border-collapse:collapse;border:1px solid rgba(255,255,255,0.08);border-radius:8px;">
${[["Invoice Number",d.invoiceNo],["Invoice Date",d.invoiceDate],["Applicant",d.recipientName],["Email",d.email],["Film Name",d.filmName],["Category",d.category],["Cashfree Order ID",d.orderId],["Payment ID",d.paymentId||"—"],["Payment Method",d.paymentMethod],["Currency","INR"]].map(([k,v])=>`<tr style="border-bottom:1px solid rgba(255,255,255,0.06);"><td style="color:#808099;font-size:12px;">${e(k)}</td><td align="right" style="color:#e0e0f0;font-size:12px;word-break:break-all;">${e(v)}</td></tr>`).join("")}
<tr style="background:rgba(212,175,55,0.08);"><td style="color:#d4af37;font-size:14px;font-weight:700;padding:16px 12px;">Total Paid</td><td align="right" style="color:#d4af37;font-size:18px;font-weight:700;padding:16px 12px;">${e(d.paidAmount)}</td></tr>
<tr><td colspan="2" align="right" style="padding:8px 12px;"><span style="display:inline-block;background:#1a4a1a;color:#4caf50;font-size:11px;font-weight:700;padding:4px 12px;border-radius:4px;">✓ Payment Successful</span></td></tr>
</table>
</td></tr>
<tr><td style="background:#0a0a14;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;border-top:1px solid rgba(212,175,55,0.15);">
<p style="margin:0 0 4px;color:#d4af37;font-size:12px;font-weight:600;">Sharankrishna Short Film Awards</p>
<p style="margin:0;color:#606080;font-size:11px;">Celebrating Cinema · Excellence in Short Films</p>
<p style="margin:12px 0 0;color:#404060;font-size:10px;">Questions? <a href="mailto:sharankrishnashortfilmawards@gmail.com" style="color:#d4af37;text-decoration:none;">sharankrishnashortfilmawards@gmail.com</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function escHtml(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
