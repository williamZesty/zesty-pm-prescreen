// Output comparison for SQL questions. Python comparison happens
// inside Pyodide (see runner-python.js gradePython).

import { EXPECTED } from "./seed.js";

const FLOAT_TOL = 1e-6;

function approxEqual(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= FLOAT_TOL + FLOAT_TOL * Math.max(Math.abs(a), Math.abs(b));
  }
  return a === b;
}

function lowerEq(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Grade a SQL result against the expected output for `qid` (q1 or q2).
// `actual` is { columns, rows } from runner-sql.js.
export function gradeSql(qid, actual) {
  const expected = EXPECTED[qid];
  if (!expected) return { passed: false, hint: `No expected output for ${qid}` };

  if (!actual || !actual.columns) {
    return { passed: false, hint: "Query returned no result set." };
  }

  // Column structure check (case-insensitive on aliases; order matters).
  const aCols = actual.columns.map((c) => String(c));
  const eCols = expected.columns;
  if (aCols.length !== eCols.length) {
    return {
      passed: false,
      hint: `Column count differs — expected ${eCols.length} (${eCols.join(", ")}), got ${aCols.length} (${aCols.join(", ") || "<none>"}).`,
    };
  }
  for (let i = 0; i < eCols.length; i++) {
    if (!lowerEq(aCols[i], eCols[i])) {
      return {
        passed: false,
        hint: `Column structure differs — expected: ${eCols.join(", ")}. Got: ${aCols.join(", ")}.`,
      };
    }
  }

  if (actual.rows.length !== expected.rows.length) {
    return {
      passed: false,
      hint: `Expected ${expected.rows.length} row${expected.rows.length === 1 ? "" : "s"}, got ${actual.rows.length} — check your filters${qid === "q2" ? " and join type (LEFT vs INNER)" : ""}.`,
    };
  }

  for (let i = 0; i < expected.rows.length; i++) {
    const aRow = actual.rows[i];
    const eRow = expected.rows[i];
    for (let j = 0; j < eRow.length; j++) {
      if (!approxEqual(aRow[j], eRow[j])) {
        return {
          passed: false,
          hint: `Row count and columns match but values differ at row ${i + 1}, column "${eCols[j]}" — check your aggregations and ordering.`,
        };
      }
    }
  }

  return { passed: true, hint: null };
}
