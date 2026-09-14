// Sharankrishna Short Film Awards — Cashfree Payment Edge Function (Deno)
// Routes by "action" field in POST body:
//   createOrder  → create Cashfree order, return payment_session_id
//   verifyOrder  → server-verify order status from Cashfree
//   (no action)  → final submission: re-verify PAID, insert film_entries, send email
//
// ⚠ SECURITY:
//   • Order amount is ALWAYS 1000 INR server-side. Never trust browser-sent amount.
//   • Cashfree credentials are Deno.env secrets only — never in browser code.
//   • SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY injected automatically by Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ──────────────────────────────────────────────────────────────
const CASHFREE_API_VERSION = "2025-01-01";
const ENV = (Deno.env.get("CASHFREE_ENV") ?? "sandbox").toLowerCase();
const CF_BASE = ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

// Server-side enforced amount — NEVER accept from browser
const ORDER_AMOUNT: number = 1000;
const ORDER_CURRENCY: string = "INR";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://sharankrishnashortfilmawards.com";
const WEBHOOK_URL = Deno.env.get("WEBHOOK_URL") ??
  "https://flwlbraeyyrofkhxnvwt.supabase.co/functions/v1/cashfree-webhook";

const cfHeaders = {
  "x-client-id": Deno.env.get("CASHFREE_APP_ID") ?? "",
  "x-client-secret": Deno.env.get("CASHFREE_SECRET") ?? "",
  "x-api-version": CASHFREE_API_VERSION,
  "Content-Type": "application/json",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ─── CORS ───────────────────────────────────────────────────────────────────
const ALLOW_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Main handler ────────────────────────────────────────────────────────────
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
    return json(await handleSubmission(data));
  } catch (err) {
    console.error("Unhandled error:", (err as Error)?.message);
    return json(
      { status: "error", message: (err as Error)?.message ?? "Internal error" },
      500,
    );
  }
});

// ─── createOrder ─────────────────────────────────────────────────────────────
async function createOrder(data: Record<string, unknown>) {
  // Validate credentials configured
  if (!cfHeaders["x-client-id"] || !cfHeaders["x-client-secret"]) {
    return { status: "error", message: "Payment gateway not configured (missing credentials)." };
  }

  const orderId =
    "SKSFA_" + new Date().getFullYear() + "_" +
    Date.now() + "_" + Math.floor(Math.random() * 99999).toString().padStart(5, "0");

  const rawPhone = String(data.customerPhone ?? "").replace(/\D/g, "").slice(-10);
  const phone = rawPhone.length === 10 ? rawPhone : "9999999999";
  const name = String(data.customerName ?? "Applicant").slice(0, 100);
  const email = String(data.customerEmail ?? "").trim() || "noemail@example.com";

  // ⚠ Amount is ALWAYS server-enforced — never from browser
  const payload = {
    order_id: orderId,
    order_amount: ORDER_AMOUNT,   // 1000 INR — hardcoded server-side
    order_currency: ORDER_CURRENCY, // INR — hardcoded server-side
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
    // Never expose credentials or secret info here
  };
}

// ─── verifyOrder ─────────────────────────────────────────────────────────────
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

  // Server-side amount validation
  if (
    order.order_status === "PAID" &&
    Number(order.order_amount) < ORDER_AMOUNT
  ) {
    console.error("Amount mismatch! Expected", ORDER_AMOUNT, "got", order.order_amount);
    return { status: "error", message: "Payment amount mismatch. Contact support." };
  }

  // Fetch payment details for cf_payment_id and payment method
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
  } catch (_) {
    // Best-effort — don't fail verification if payments list fails
  }

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

// ─── handleSubmission (final form submit) ────────────────────────────────────
async function handleSubmission(data: Record<string, unknown>) {
  const orderId = String(data.cashfreeOrderId ?? "").trim();
  if (!orderId) return { status: "error", message: "Missing payment reference (cashfreeOrderId)." };

  // Re-verify from Cashfree server — never trust frontend
  const check = await verifyOrder(orderId);
  if (check.status !== "success" || String(check.order_status).toUpperCase() !== "PAID") {
    return {
      status: "error",
      message: "Payment not verified for this order. Status: " +
        (check.order_status ?? check.message ?? "unknown"),
    };
  }

  // Check order not already consumed by another submission
  const { data: existing } = await supabase
    .from("film_entries")
    .select("id, confirmation_sent")
    .eq("cashfree_order_id", orderId)
    .single();

  // If already submitted, return success (idempotent — user may have refreshed)
  if (existing) {
    return {
      status: "success",
      message: "Entry already registered.",
      already_registered: true,
    };
  }

  // ── Source tracking: resolve direct-link token server-side ─────────────────
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
        // Increment use_count (best-effort, non-blocking)
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
    amount: check.order_amount,       // server-verified amount, not from browser
    currency: check.order_currency,   // server-verified currency
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
    // If unique constraint violation (double-submit race), return success
    if (error.code === "23505") {
      return { status: "success", message: "Entry already registered.", already_registered: true };
    }
    console.error("DB insert error:", error.message);
    return { status: "error", message: error.message };
  }

  // Send confirmation email (non-blocking — don't fail submission if email fails)
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

// ─── sendConfirmationEmail ────────────────────────────────────────────────────
async function sendConfirmationEmail(entry: Record<string, unknown>) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoKey) {
    console.warn("BREVO_API_KEY not set — skipping email");
    return;
  }

  const recipientEmail = String(entry.email ?? "");
  const recipientName = String(entry.applicant_name ?? "Applicant");
  if (!recipientEmail || !recipientEmail.includes("@")) return;

  const invoiceNo = "SKSFA-" + new Date().getFullYear() + "-" +
    String(entry.cashfree_order_id ?? "").slice(-6);
  const invoiceDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const paidAmount = "₹" + Number(entry.amount || 1000).toLocaleString("en-IN");
  const paymentMethodLabel = String(entry.payment_method ?? "Online Payment");

  const html = buildEmailHtml({
    recipientName,
    invoiceNo,
    invoiceDate,
    filmName: String(entry.film_name ?? ""),
    category: String(entry.category ?? ""),
    orderId: String(entry.cashfree_order_id ?? ""),
    paymentId: String(entry.cashfree_payment_id ?? ""),
    paymentMethod: paymentMethodLabel,
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
    headers: {
      "api-key": brevoKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error("Brevo API error " + resp.status + ": " + errBody);
  }

  console.log("Confirmation email sent to", recipientEmail, "for order", entry.cashfree_order_id);
}

// ─── Email HTML builder ───────────────────────────────────────────────────────
function buildEmailHtml(d: {
  recipientName: string;
  invoiceNo: string;
  invoiceDate: string;
  filmName: string;
  category: string;
  orderId: string;
  paymentId: string;
  paymentMethod: string;
  paidAmount: string;
  email: string;
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entry Confirmed — Sharankrishna Short Film Awards</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">

<!-- Wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- ── HEADER / THANK YOU CARD ── -->
  <tr><td style="background:linear-gradient(135deg,#1a0a2e 0%,#0d1a2e 50%,#1a0a2e 100%);border-radius:16px 16px 0 0;padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(212,175,55,0.3);">
    <!-- Film strip accent -->
    <div style="display:inline-block;margin-bottom:20px;">
      <span style="font-size:36px;">🎬</span>
    </div>
    <p style="margin:0 0 8px;color:#d4af37;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:600;">Sharankrishna Short Film Awards</p>
    <h1 style="margin:0 0 12px;color:#ffffff;font-size:28px;font-weight:700;line-height:1.2;">Congratulations!</h1>
    <h2 style="margin:0 0 20px;color:#e8d5a3;font-size:18px;font-weight:400;line-height:1.4;">Your festival entry has been received</h2>
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;">
      Thank you for participating in the Sharankrishna Short Film Awards.<br>
      We appreciate your passion for cinema and wish you the very best.
    </p>
    <!-- Gold divider -->
    <div style="margin:28px auto 0;width:80px;height:2px;background:linear-gradient(90deg,transparent,#d4af37,transparent);"></div>
  </td></tr>

  <!-- ── FILM ENTRY CONFIRMATION ── -->
  <tr><td style="background:#12121f;padding:32px 40px;">
    <p style="margin:0 0 8px;color:#d4af37;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Film Entry</p>
    <h3 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:700;">${escHtml(d.filmName)}</h3>
    <p style="margin:0 0 24px;color:#a0a0c0;font-size:14px;">Category: ${escHtml(d.category)}</p>
    <p style="margin:0;color:#c0c0d8;font-size:14px;line-height:1.7;">
      Dear ${escHtml(d.recipientName)},<br><br>
      Your payment was successful and your entry has been officially registered for the
      <strong style="color:#d4af37;">Sharankrishna Short Film Awards</strong>.
      You will receive further communications regarding screening schedules, results,
      and the awards ceremony at this email address.
    </p>
  </td></tr>

  <!-- ── INVOICE ── -->
  <tr><td style="background:#0f0f1e;padding:0 40px 32px;">
    <!-- Invoice header -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;padding-top:24px;border-top:1px solid rgba(212,175,55,0.2);">
      <tr>
        <td style="color:#d4af37;font-size:10px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Payment Invoice</td>
        <td align="right" style="color:#a0a0c0;font-size:12px;">${escHtml(d.invoiceNo)}</td>
      </tr>
    </table>

    <!-- Invoice table -->
    <table width="100%" cellpadding="12" cellspacing="0" style="border-collapse:collapse;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Invoice Number</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.invoiceNo)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Invoice Date</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.invoiceDate)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Applicant</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.recipientName)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Email</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.email)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Film Name</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.filmName)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Category</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.category)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Cashfree Order ID</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;word-break:break-all;">${escHtml(d.orderId)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Payment ID</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;word-break:break-all;">${escHtml(d.paymentId || "—")}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Payment Method</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">${escHtml(d.paymentMethod)}</td>
      </tr>
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="color:#808099;font-size:12px;font-weight:500;">Currency</td>
        <td align="right" style="color:#e0e0f0;font-size:12px;">INR</td>
      </tr>
      <!-- Total row -->
      <tr style="background:rgba(212,175,55,0.08);">
        <td style="color:#d4af37;font-size:14px;font-weight:700;padding:16px 12px;">Total Paid</td>
        <td align="right" style="color:#d4af37;font-size:18px;font-weight:700;padding:16px 12px;">${escHtml(d.paidAmount)}</td>
      </tr>
      <tr>
        <td colspan="2" align="right" style="padding:8px 12px;">
          <span style="display:inline-block;background:#1a4a1a;color:#4caf50;font-size:11px;font-weight:700;letter-spacing:1px;padding:4px 12px;border-radius:4px;text-transform:uppercase;">✓ Payment Successful</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ── FOOTER ── -->
  <tr><td style="background:#0a0a14;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;border-top:1px solid rgba(212,175,55,0.15);">
    <p style="margin:0 0 8px;color:#d4af37;font-size:12px;font-weight:600;">Sharankrishna Short Film Awards</p>
    <p style="margin:0 0 4px;color:#606080;font-size:11px;">Celebrating Cinema · Excellence in Short Films</p>
    <p style="margin:12px 0 0;color:#404060;font-size:10px;">
      Questions? Write to <a href="mailto:sharankrishnashortfilmawards@gmail.com" style="color:#d4af37;text-decoration:none;">sharankrishnashortfilmawards@gmail.com</a>
    </p>
    <p style="margin:8px 0 0;color:#303050;font-size:10px;">This is an automated confirmation. Please keep this for your records.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// HTML-escape for email content (prevent XSS in email body)
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
