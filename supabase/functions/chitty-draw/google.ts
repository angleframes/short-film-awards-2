// Google Sheets API access with a service account (server-side only; credentials never reach the browser).
// Secret GOOGLE_SERVICE_ACCOUNT_JSON = the service account's JSON key.
// The sheet must be shared with the service account's client_email (Editor, so WINNER can be written back).

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
let cached: { token: string; exp: number } | null = null;

export class SheetError extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function credentials(): { client_email: string; private_key: string } {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new SheetError("Google Sheet access is not configured yet (GOOGLE_SERVICE_ACCOUNT_JSON is missing).");
  try {
    const j = JSON.parse(raw);
    if (!j.client_email || !j.private_key) throw new Error();
    return j;
  } catch {
    throw new SheetError("GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service account key.");
  }
}

async function accessToken(): Promise<string> {
  if (cached && cached.exp - 60 > Date.now() / 1000) return cached.token;
  const { client_email, private_key } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new SheetError(`Google sign-in for the service account failed (${res.status}).`);
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return cached.token;
}

async function call(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    if (e instanceof SheetError) throw e;
    throw new SheetError("The Google Sheet could not be reached. No draw was made.");
  }
  if (res.status === 403 || res.status === 404) {
    throw new SheetError("The service account cannot open the Google Sheet. Share the sheet with its email address as Editor.");
  }
  if (!res.ok) throw new SheetError(`Google Sheets returned an error (${res.status}). No draw was made.`);
  return res.json();
}

const range = (tab: string, a1: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${a1}`);

/** Fresh read of a range (never cached). */
export async function readRange(sheetId: string, tab: string, a1: string): Promise<unknown[][]> {
  const j = await call(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range(tab, a1)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  return j.values ?? [];
}

/** Writes a single cell value. */
export async function writeCell(sheetId: string, tab: string, cell: string, value: string): Promise<void> {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range(tab, cell)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range: `'${tab}'!${cell}`, majorDimension: "ROWS", values: [[value]] }),
  });
}
