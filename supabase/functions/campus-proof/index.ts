// Sharankrishna Short Film Awards — Campus Track student-verification upload (Deno)
// POST multipart/form-data { file } → validates server-side, stores privately, returns proof_id.
// Files land in the PRIVATE "campus-verification" bucket under a random UUID name.
// Only the service role can write; only admins (is_admin()) can read via short-lived signed URLs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_BYTES, validateUpload } from "./validate.ts";

const BUCKET = "campus-verification";
const RATE_LIMIT_PER_HOUR = 10;
const ALLOWED_ORIGINS = (Deno.env.get("CAMPUS_PROOF_ORIGINS") ??
  "https://sharankrishnashortfilmawards.com,https://www.sharankrishnashortfilmawards.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

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

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { status: "error", message: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json(req, { status: "error", message: "Origin not allowed" }, 403);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) {
    return json(req, { status: "error", code: "too_large", message: "File is larger than 5 MB. Please upload a smaller PDF or JPG." }, 413);
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return json(req, { status: "error", message: "Expected a file upload." }, 400);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256Hex("campus-proof:" + ip + ":" + (Deno.env.get("SUPABASE_URL") ?? ""));

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("campus_proof_uploads")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json(req, { status: "error", code: "rate_limited", message: "Too many uploads. Please wait a while and try again." }, 429);
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json(req, { status: "error", message: "Could not read the uploaded file." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return json(req, { status: "error", message: "No file received." }, 400);
    if (file.size > MAX_BYTES) {
      return json(req, { status: "error", code: "too_large", message: "File is larger than 5 MB. Please upload a smaller PDF or JPG." }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const v = validateUpload(file.name, file.type, bytes);
    if (!v.ok) {
      console.warn("campus-proof rejected:", v.code, "size", bytes.length);
      return json(req, { status: "error", code: v.code, message: v.message }, 422);
    }

    const id = crypto.randomUUID();
    const objectPath = `${new Date().getUTCFullYear()}/${id}.${v.type.ext}`;
    const digest = await sha256Hex(bytes);

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: v.type.mime,
      upsert: false,
      cacheControl: "no-store",
    });
    if (upErr) {
      console.error("campus-proof storage error:", upErr.message);
      return json(req, { status: "error", message: "Upload failed. Please try again." }, 500);
    }

    const { error: rowErr } = await supabase.from("campus_proof_uploads").insert({
      id,
      object_path: objectPath,
      mime_type: v.type.mime,
      size_bytes: bytes.length,
      sha256: digest,
      ip_hash: ipHash,
    });
    if (rowErr) {
      console.error("campus-proof row error:", rowErr.message);
      await supabase.storage.from(BUCKET).remove([objectPath]);
      return json(req, { status: "error", message: "Upload failed. Please try again." }, 500);
    }

    return json(req, { status: "success", proof_id: id, type: v.type.kind, size: bytes.length });
  } catch (err) {
    console.error("campus-proof unhandled:", (err as Error)?.message);
    return json(req, { status: "error", message: "Upload failed. Please try again." }, 500);
  }
});
