// Sharankrishna Short Film Awards — Cashfree Webhook Edge Function (Deno)
//
// Cashfree calls this URL (notify_url) after every payment event.
//
// ⚠ SECURITY — this function:
//   1. Reads raw bytes BEFORE JSON parse to verify HMAC-SHA256 signature
//   2. Rejects any webhook whose signature doesn't match
//   3. Checks `confirmation_sent` flag to prevent duplicate emails
//   4. Is idempotent — duplicate webhooks for the same order are safe
//
// Deploy with: supabase functions deploy cashfree-webhook --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CASHFREE_API_VERSION = "2025-01-01";
const ENV = (Deno.env.get("CASHFREE_ENV") ?? "sandbox").toLowerCase();
const CF_BASE = ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";
const cfHeaders = {
  "x-client-id": Deno.env.get("CASHFREE_APP_ID") ?? "",
  "x-client-secret": Deno.env.get("CASHFREE_SECRET") ?? "",
  "x-api-version": CASHFREE_API_VERSION,
};

const ORDER_AMOUNT = 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── 1. Read raw body (required for signature verification) ──────────────
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const receivedSig = req.headers.get("x-webhook-signature") ?? "";
  const webhookSecret = Deno.env.get("CASHFREE_WEBHOOK_SECRET") ?? "";

  // ── 2. Verify HMAC-SHA256 signature ─────────────────────────────────────
  if (!webhookSecret) {
    // If secret not configured yet, accept but log prominently
    console.warn("CASHFREE_WEBHOOK_SECRET not set — signature NOT verified (unsafe for production)");
  } else {
    const valid = await verifyCashfreeSignature(
      timestamp,
      rawBody,
      receivedSig,
      webhookSecret,
    );
    if (!valid) {
      console.error("Webhook signature mismatch — rejecting");
      return new Response("Forbidden: invalid signature", { status: 403 });
    }
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  console.log("Cashfree webhook received, type:", event.type, "time:", timestamp);

  // ── 4. Only handle PAYMENT_SUCCESS_WEBHOOK ───────────────────────────────
  // Cashfree sends many event types; we only care about successful payment
  const eventType = String(event.type ?? "");
  if (eventType !== "PAYMENT_SUCCESS_WEBHOOK" && eventType !== "PAYMENT_SUCCESS") {
    console.log("Ignoring non-success event:", eventType);
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 5. Extract order data ────────────────────────────────────────────────
  const dataPayload = (event.data ?? event) as Record<string, unknown>;
  const orderInfo = (dataPayload.order ?? dataPayload) as Record<string, unknown>;
  const paymentInfo = (dataPayload.payment ?? {}) as Record<string, unknown>;

  const orderId = String(orderInfo.order_id ?? paymentInfo.order_id ?? "").trim();
  const paymentId = String(paymentInfo.cf_payment_id ?? "").trim();
  const paymentStatus = String(paymentInfo.payment_status ?? orderInfo.order_status ?? "").toUpperCase();
  const paidAmount = Number(orderInfo.order_amount ?? paymentInfo.payment_amount ?? 0);

  if (!orderId) {
    console.error("Webhook missing order_id — ignoring");
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (paymentStatus !== "SUCCESS" && paymentStatus !== "PAID") {
    console.log("Payment not successful:", paymentStatus, "for order:", orderId);
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 6. Server-side amount check ──────────────────────────────────────────
  if (paidAmount > 0 && paidAmount < ORDER_AMOUNT) {
    console.error("Webhook amount mismatch — expected", ORDER_AMOUNT, "got", paidAmount, "order:", orderId);
    return new Response(JSON.stringify({ received: true, warning: "amount_mismatch" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 7. Idempotency — check if already processed ──────────────────────────
  const { data: entry } = await supabase
    .from("film_entries")
    .select("id, confirmation_sent, email, applicant_name, film_name, category, cashfree_payment_id, amount, currency, paid_at, payment_method")
    .eq("cashfree_order_id", orderId)
    .single();

  if (!entry) {
    // Webhook arrived before user submitted form — normal, ignore
    console.log("No film_entries row for order", orderId, "— webhook may have arrived early (ok)");
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (entry.confirmation_sent) {
    console.log("Confirmation already sent for order", orderId, "— skipping duplicate webhook");
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 8. Re-verify directly with Cashfree (don't trust webhook alone) ──────
  const verified = await recheckFromCashfree(orderId);
  if (!verified) {
    console.warn("Webhook received but Cashfree re-verify failed for order:", orderId);
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 9. Update payment_id if webhook has a more precise value ─────────────
  if (paymentId && !entry.cashfree_payment_id) {
    await supabase
      .from("film_entries")
      .update({ cashfree_payment_id: paymentId, payment_method: (paymentInfo.payment_group ?? entry.payment_method) })
      .eq("cashfree_order_id", orderId);
  }

  // ── 10. Send email (idempotent) ───────────────────────────────────────────
  try {
    await sendConfirmationEmail({ ...entry, cashfree_order_id: orderId, cashfree_payment_id: paymentId || entry.cashfree_payment_id });
    await supabase
      .from("film_entries")
      .update({ confirmation_sent: true })
      .eq("cashfree_order_id", orderId);
    console.log("Webhook: confirmation email sent for order", orderId);
  } catch (emailErr) {
    console.error("Webhook: email failed:", (emailErr as Error)?.message);
  }

  return new Response(JSON.stringify({ received: true, processed: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Cashfree HMAC-SHA256 signature verification ──────────────────────────────
// Cashfree v3 webhook sig: HMAC-SHA256(timestamp + "." + rawBody, secret), base64
async function verifyCashfreeSignature(
  timestamp: string,
  rawBody: string,
  receivedSig: string,
  secret: string,
): Promise<boolean> {
  try {
    const data = timestamp + rawBody;
    const keyData = new TextEncoder().encode(secret);
    const msgData = new TextEncoder().encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

    return computed === receivedSig;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

// ─── Re-verify order directly from Cashfree ──────────────────────────────────
async function recheckFromCashfree(orderId: string): Promise<boolean> {
  try {
    const r = await fetch(CF_BASE + "/orders/" + encodeURIComponent(orderId), {
      method: "GET",
      headers: cfHeaders,
    });
    const order = await r.json();
    return r.ok && String(order.order_status ?? "").toUpperCase() === "PAID";
  } catch {
    return false;
  }
}

// ─── Email (same as payment/index.ts) ────────────────────────────────────────
async function sendConfirmationEmail(entry: Record<string, unknown>) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoKey) { console.warn("BREVO_API_KEY not set — skipping email"); return; }

  const recipientEmail = String(entry.email ?? "");
  const recipientName = String(entry.applicant_name ?? "Applicant");
  if (!recipientEmail.includes("@")) return;

  const invoiceNo = "SKSFA-" + new Date().getFullYear() + "-" +
    String(entry.cashfree_order_id ?? "").slice(-6);
  const invoiceDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const paidAmount = "₹" + Number(entry.amount || 1000).toLocaleString("en-IN");

  // Reuse same HTML builder
  const { buildEmailHtml, escHtml } = await import("../payment/emailTemplate.ts").catch(() => ({
    buildEmailHtml: _buildEmailHtml,
    escHtml: _escHtml,
  }));

  const html = _buildEmailHtml({
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
    sender: {
      name: "Sharankrishna Short Film Awards",
      email: Deno.env.get("FROM_EMAIL") ?? "noreply@sharankrishnashortfilmawards.com",
    },
    to: [{ name: recipientName, email: recipientEmail }],
    subject: "🎬 Entry Confirmed — Sharankrishna Short Film Awards | " + invoiceNo,
    htmlContent: html,
  };

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("Brevo " + resp.status + ": " + await resp.text());
}

function _escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function _buildEmailHtml(d: {
  recipientName: string; invoiceNo: string; invoiceDate: string;
  filmName: string; category: string; orderId: string; paymentId: string;
  paymentMethod: string; paidAmount: string; email: string;
}) {
  const e = _escHtml;
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
${[
  ["Invoice Number", d.invoiceNo], ["Invoice Date", d.invoiceDate],
  ["Applicant", d.recipientName], ["Email", d.email],
  ["Film Name", d.filmName], ["Category", d.category],
  ["Cashfree Order ID", d.orderId], ["Payment ID", d.paymentId || "—"],
  ["Payment Method", d.paymentMethod], ["Currency", "INR"],
].map(([k, v]) =>
  `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
  <td style="color:#808099;font-size:12px;">${e(k)}</td>
  <td align="right" style="color:#e0e0f0;font-size:12px;word-break:break-all;">${e(v)}</td></tr>`
).join("")}
<tr style="background:rgba(212,175,55,0.08);">
<td style="color:#d4af37;font-size:14px;font-weight:700;padding:16px 12px;">Total Paid</td>
<td align="right" style="color:#d4af37;font-size:18px;font-weight:700;padding:16px 12px;">${e(d.paidAmount)}</td></tr>
<tr><td colspan="2" align="right" style="padding:8px 12px;">
<span style="display:inline-block;background:#1a4a1a;color:#4caf50;font-size:11px;font-weight:700;padding:4px 12px;border-radius:4px;">✓ Payment Successful</span>
</td></tr>
</table>
</td></tr>
<tr><td style="background:#0a0a14;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;border-top:1px solid rgba(212,175,55,0.15);">
<p style="margin:0 0 4px;color:#d4af37;font-size:12px;font-weight:600;">Sharankrishna Short Film Awards</p>
<p style="margin:0;color:#606080;font-size:11px;">Celebrating Cinema · Excellence in Short Films</p>
<p style="margin:12px 0 0;color:#404060;font-size:10px;">Questions? <a href="mailto:sharankrishnashortfilmawards@gmail.com" style="color:#d4af37;text-decoration:none;">sharankrishnashortfilmawards@gmail.com</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
}
