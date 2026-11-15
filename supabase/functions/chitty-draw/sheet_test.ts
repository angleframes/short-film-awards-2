// deno test supabase/functions/chitty-draw/sheet_test.ts
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildPool, CATEGORIES, poolFingerprint, secureIndex } from "./sheet.ts";

// Synthetic sheet in the verified layout: A/B = ₹1,000, C/D = ₹3,000, no header row.
const rows = [
  ["Asha", "", "Bala", "WINNER"],
  ["Ravi", "WINNER", "Cyril", ""],
  ["Asha", "", "", ""],            // same name again → separate slot
  ["", "", "Devi", ""],            // empty ₹1,000 cell ignored
  ["  Meena  ", "winner", "Ravi", ""], // trimmed + case-insensitive marker; Ravi also in ₹3,000
  ["1234", "", "", "WINNER"],      // invalid name + status with no name → flagged
  ["Nisha", "PAID", "Eli", ""],    // unknown status → flagged, not guessed
  [],                              // blank row
  ["Omar"],                        // short row (no status cell)
];

Deno.test("₹1,000 pool reads A/B only", () => {
  const p = buildPool(rows, CATEGORIES["1000"]);
  assertEquals(p.eligible.map((s) => s.nameCell), ["A1", "A3", "A9"]);
  assertEquals(p.sheetWinners.map((s) => s.name), ["Ravi", "Meena"]);
  assertEquals(p.total, 6); // Asha, Ravi, Asha, Meena, Nisha, Omar ("1234" is invalid)
  assertEquals(p.flags.map((f) => f.cell).sort(), ["A6", "B7"]);
  assertEquals(p.duplicateNames, [{ name: "Asha", cells: ["A1", "A3"] }]);
});

Deno.test("₹3,000 pool reads C/D only; categories never mix", () => {
  const p = buildPool(rows, CATEGORIES["3000"]);
  assertEquals(p.eligible.map((s) => s.name), ["Cyril", "Devi", "Ravi", "Eli"]);
  assertEquals(p.sheetWinners.map((s) => s.nameCell), ["C1"]);
  assertEquals(p.flags, [{ cell: "D6", issue: 'Status "WINNER" has no participant name next to it' }]);
  // Ravi won ₹1,000 but stays eligible for ₹3,000 (independent chitties).
  assert(p.eligible.some((s) => s.name === "Ravi" && s.nameCell === "C5"));
});

Deno.test("winners recorded by the system are excluded even without the sheet mark", () => {
  const p = buildPool(rows, CATEGORIES["1000"], [{ nameCell: "A3", name: "asha" }]);
  assertEquals(p.eligible.map((s) => s.nameCell), ["A1", "A9"]);
  assertEquals(p.recordedWinners.map((s) => s.nameCell), ["A3"]);
});

Deno.test("a recorded win does not exclude a different person later typed into that row", () => {
  const p = buildPool(rows, CATEGORIES["1000"], [{ nameCell: "A3", name: "Someone Else" }]);
  assert(p.eligible.some((s) => s.nameCell === "A3"));
});

Deno.test("header rows can be skipped", () => {
  const p = buildPool([["Name", "Status", "Name", "Status"], ...rows], CATEGORIES["1000"], [], 1);
  assertEquals(p.eligible[0].nameCell, "A2");
});

Deno.test("secureIndex is uniform and rejects modulo bias", () => {
  const counts = [0, 0, 0];
  for (let i = 0; i < 30000; i++) counts[secureIndex(3)]++;
  for (const c of counts) assert(c > 9300 && c < 10700, `uneven: ${counts}`);
  // Values in the biased tail (>= limit) must be re-drawn.
  const seq = [0xffffffff, 7];
  assertEquals(secureIndex(3, (b) => { b[0] = seq.shift()!; return b; }), 1);
  assertThrows(() => secureIndex(0));
});

Deno.test("pool fingerprint changes when the pool changes", async () => {
  const a = buildPool(rows, CATEGORIES["1000"]).eligible;
  assert((await poolFingerprint(a)) !== (await poolFingerprint(a.slice(1))));
});
