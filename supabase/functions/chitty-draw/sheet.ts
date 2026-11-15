// ANGLE FRAMES CHITTY — Google Sheet participant parsing, eligibility and secure selection.
// Pure functions (no I/O) so they can be unit-tested with `deno test`.
//
// Verified sheet layout (Sheet1, no header row):
//   ₹1,000 chitty → column A = participant name, column B = status ("WINNER" or blank)
//   ₹3,000 chitty → column C = participant name, column D = status ("WINNER" or blank)
// Each row is its own chitty slot: the same name on two rows is two separate slots.
// The two chitties are independent: winning one does not affect eligibility in the other.

export type CategoryKey = "1000" | "3000";

export interface CategoryConfig {
  key: CategoryKey;
  label: string;
  amount: number;
  nameCol: string; // e.g. "A"
  statusCol: string; // e.g. "B"
}

export const CATEGORIES: Record<CategoryKey, CategoryConfig> = {
  "1000": { key: "1000", label: "₹1,000 Chitty", amount: 1000, nameCol: "A", statusCol: "B" },
  "3000": { key: "3000", label: "₹3,000 Chitty", amount: 3000, nameCol: "C", statusCol: "D" },
};

export const WINNER_MARK = "WINNER";

export interface Slot {
  row: number; // 1-based sheet row
  nameCell: string; // "A9"
  statusCell: string; // "B9"
  name: string;
  status: string; // raw status cell text (trimmed)
}

export interface Flag {
  cell: string;
  issue: string;
}

export interface CategoryPool {
  key: CategoryKey;
  label: string;
  amount: number;
  total: number; // valid participant slots
  sheetWinners: Slot[]; // marked WINNER in the sheet
  recordedWinners: Slot[]; // drawn by this system but not (yet) marked in the sheet
  eligible: Slot[];
  flags: Flag[]; // rows left out of the draw for review
  duplicateNames: { name: string; cells: string[] }[]; // informational: same name on several rows
}

const colIndex = (col: string) => col.toUpperCase().charCodeAt(0) - 65;
const normalise = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const nameKey = (s: string) => normalise(s).toLowerCase();

/** A usable participant name: has a letter, sensible length, no control characters. */
export function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= 80 && /\p{L}/u.test(name) && !/[\u0000-\u001f]/.test(name);
}

/**
 * Builds one category's pool from raw sheet rows (values API, ROWS major dimension).
 * `recorded` = name cells already drawn by this system for this category (from chitty_draws),
 * so a winner is excluded even if the WINNER write-back to the sheet failed or was removed.
 */
export function buildPool(
  rows: unknown[][],
  cfg: CategoryConfig,
  recorded: { nameCell: string; name: string }[] = [],
  headerRows = 0,
): CategoryPool {
  const ni = colIndex(cfg.nameCol);
  const si = colIndex(cfg.statusCol);
  const recordedKeys = new Set(recorded.map((r) => `${r.nameCell}|${nameKey(r.name)}`));
  const pool: CategoryPool = {
    key: cfg.key, label: cfg.label, amount: cfg.amount, total: 0,
    sheetWinners: [], recordedWinners: [], eligible: [], flags: [], duplicateNames: [],
  };
  const byName = new Map<string, string[]>();

  rows.forEach((r, i) => {
    const row = i + 1;
    if (row <= headerRows) return;
    const name = normalise(r?.[ni]);
    const status = normalise(r?.[si]);
    const nameCell = `${cfg.nameCol}${row}`;
    const statusCell = `${cfg.statusCol}${row}`;
    if (!name) {
      if (status) pool.flags.push({ cell: statusCell, issue: `Status "${status}" has no participant name next to it` });
      return; // empty cell: ignored
    }
    if (!isValidName(name)) {
      pool.flags.push({ cell: nameCell, issue: "Not a valid participant name" });
      return;
    }
    const slot: Slot = { row, nameCell, statusCell, name, status };
    pool.total++;
    const k = nameKey(name);
    byName.set(k, [...(byName.get(k) ?? []), nameCell]);

    if (status.toUpperCase() === WINNER_MARK) {
      pool.sheetWinners.push(slot);
    } else if (status) {
      // Unknown marker — do not guess whether this person has won.
      pool.flags.push({ cell: statusCell, issue: `Unrecognised status "${status}" (expected "${WINNER_MARK}" or blank)` });
    } else if (recordedKeys.has(`${nameCell}|${k}`)) {
      pool.recordedWinners.push(slot);
    } else {
      pool.eligible.push(slot);
    }
  });

  for (const [, cells] of byName) {
    if (cells.length > 1) {
      const first = rows[Number(cells[0].slice(1)) - 1]?.[ni];
      pool.duplicateNames.push({ name: normalise(first), cells });
    }
  }
  return pool;
}

/** Unbiased integer in [0, n) from a CSPRNG (rejection sampling). */
export function secureIndex(n: number, rand: (buf: Uint32Array) => Uint32Array = (b) => crypto.getRandomValues(b)): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pool is empty");
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    rand(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Stable fingerprint of an eligible pool, stored with every draw for auditing. */
export async function poolFingerprint(slots: Slot[]): Promise<string> {
  const text = slots.map((s) => `${s.nameCell}\t${s.name}`).join("\n");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Public-safe view of a slot for the draw screen. */
export const slotView = (s: Slot) => ({ cell: s.nameCell, row: s.row, name: s.name });
