// Server-side validation for Campus Track student-verification uploads.
// Trusts nothing from the client: extension, MIME and bytes must all agree.

export const MAX_BYTES = 5 * 1024 * 1024;

export type DetectedType = { kind: "pdf" | "jpeg"; mime: "application/pdf" | "image/jpeg"; ext: "pdf" | "jpg" };

export type ValidationResult =
  | { ok: true; type: DetectedType }
  | { ok: false; code: string; message: string };

const ALLOWED_EXT: Record<string, "pdf" | "jpeg"> = { pdf: "pdf", jpg: "jpeg", jpeg: "jpeg" };

// Any of these appearing as an inner extension ("id.exe.pdf") marks a disguised file.
const DANGEROUS_EXT = new Set([
  "exe", "js", "mjs", "cjs", "html", "htm", "xhtml", "shtml", "php", "phtml", "sh", "bash", "bat", "cmd",
  "com", "scr", "msi", "dll", "jar", "vbs", "vbe", "wsf", "ps1", "py", "pl", "rb", "cgi", "asp", "aspx",
  "jsp", "svg", "svgz", "xml", "zip", "rar", "7z", "gz", "tar", "iso", "apk", "app", "dmg", "lnk", "hta",
]);

const BROWSER_MIME_OK: Record<"pdf" | "jpeg", string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  jpeg: ["image/jpeg", "image/pjpeg", "image/jpg"],
};

// Markers of active content / polyglots. Checked case-insensitively on a latin1 view.
const PDF_ACTIVE = [/\/JavaScript\b/i, /\/JS[\s\/(<\[]/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/SubmitForm\b/, /\/ImportData\b/];
const POLYGLOT = [/<script[\s>]/i, /<\?php/i, /<html[\s>]/i, /<svg[\s>]/i, /<iframe[\s>]/i, /javascript:/i];

const fail = (code: string, message: string): ValidationResult => ({ ok: false, code, message });

export function validateFilename(name: string): { ok: true; ext: string } | { ok: false; code: string; message: string } {
  if (!name || name.length > 200) return { ok: false, code: "bad_name", message: "Invalid file name." };
  // deno-lint-ignore no-control-regex
  if (/[\/\\\x00-\x1f\x7f]/.test(name) || name.includes("..")) {
    return { ok: false, code: "bad_name", message: "Invalid file name." };
  }
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2 || !parts[0].trim()) return { ok: false, code: "bad_ext", message: "Only PDF or JPG files are accepted." };
  const ext = parts[parts.length - 1];
  if (!(ext in ALLOWED_EXT)) return { ok: false, code: "bad_ext", message: "Only PDF or JPG files are accepted." };
  for (const inner of parts.slice(1, -1)) {
    if (DANGEROUS_EXT.has(inner.trim())) {
      return { ok: false, code: "disguised", message: "This file appears to be disguised and was rejected. Please upload a genuine PDF or JPG." };
    }
  }
  return { ok: true, ext };
}

function sniff(b: Uint8Array): "pdf" | "jpeg" | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf"; // %PDF-
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

function latin1(b: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return s;
}

function jpegStructureOk(b: Uint8Array): boolean {
  // Walk marker segments from SOI up to SOS; every segment must be well-formed.
  let i = 2;
  let sawFrame = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; }
    if (m === 0xda) return sawFrame; // SOS: image data follows
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return false;
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) sawFrame = true;
    i += 2 + len;
  }
  return false;
}

function hasJpegEnd(b: Uint8Array): boolean {
  const start = Math.max(0, b.length - 4096);
  for (let i = b.length - 2; i >= start; i--) if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
  return false;
}

export function validateUpload(name: string, browserMime: string, bytes: Uint8Array): ValidationResult {
  if (bytes.length === 0) return fail("empty", "The selected file is empty.");
  if (bytes.length > MAX_BYTES) return fail("too_large", "File is larger than 5 MB. Please upload a smaller PDF or JPG.");

  const fn = validateFilename(name);
  if (!fn.ok) return fail(fn.code, fn.message);
  const claimed = ALLOWED_EXT[fn.ext];

  const actual = sniff(bytes);
  if (!actual) return fail("bad_signature", "This file is not a genuine PDF or JPG and was rejected.");
  if (actual !== claimed) return fail("mismatch", "The file's contents do not match its extension. Please upload a genuine PDF or JPG.");

  const bm = (browserMime || "").toLowerCase().split(";")[0].trim();
  if (bm && bm !== "application/octet-stream" && !BROWSER_MIME_OK[actual].includes(bm)) {
    return fail("mime_mismatch", "The file type does not match its contents and was rejected.");
  }

  const text = latin1(bytes);
  if (POLYGLOT.some((re) => re.test(text))) {
    return fail("active_content", "This file contains embedded code and was rejected.");
  }

  if (actual === "pdf") {
    if (!text.slice(-2048).includes("%%EOF")) return fail("bad_structure", "This PDF appears damaged or incomplete. Please export it again and retry.");
    if (PDF_ACTIVE.some((re) => re.test(text))) {
      return fail("active_content", "PDFs with scripts, attachments or interactive actions are not accepted. Please upload a plain PDF or a JPG photo.");
    }
    return { ok: true, type: { kind: "pdf", mime: "application/pdf", ext: "pdf" } };
  }

  if (!jpegStructureOk(bytes) || !hasJpegEnd(bytes)) {
    return fail("bad_structure", "This JPG appears damaged or incomplete. Please retake or re-export the image.");
  }
  return { ok: true, type: { kind: "jpeg", mime: "image/jpeg", ext: "jpg" } };
}
