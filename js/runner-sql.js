// SQL.js runner — loads SQLite WASM, seeds the database, runs candidate queries.

import { SEED } from "./seed.js";

const SQL_WASM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";

let _dbPromise = null;

async function loadSqlJs() {
  // SQL.js exposes a global `initSqlJs` after the script tag loads.
  if (typeof window.initSqlJs !== "function") {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SQL_WASM_CDN + "sql-wasm.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load sql.js"));
      document.head.appendChild(s);
    });
  }
  return window.initSqlJs({ locateFile: (f) => SQL_WASM_CDN + f });
}

async function buildDb() {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE properties (
      property_id INTEGER PRIMARY KEY,
      address TEXT,
      state TEXT,
      year_built INTEGER,
      roof_age_years INTEGER,
      square_feet INTEGER
    );
    CREATE TABLE policies (
      policy_id INTEGER PRIMARY KEY,
      property_id INTEGER,
      customer_name TEXT,
      annual_premium REAL,
      coverage_amount REAL,
      start_date TEXT,
      FOREIGN KEY (property_id) REFERENCES properties(property_id)
    );
    CREATE TABLE claims (
      claim_id INTEGER PRIMARY KEY,
      policy_id INTEGER,
      claim_date TEXT,
      claim_amount REAL,
      claim_type TEXT,
      status TEXT,
      FOREIGN KEY (policy_id) REFERENCES policies(policy_id)
    );
  `);

  const insert = (table, cols, rows) => {
    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    );
    for (const row of rows) {
      stmt.run(cols.map((c) => row[c]));
    }
    stmt.free();
  };

  insert("properties",
    ["property_id", "address", "state", "year_built", "roof_age_years", "square_feet"],
    SEED.properties);
  insert("policies",
    ["policy_id", "property_id", "customer_name", "annual_premium", "coverage_amount", "start_date"],
    SEED.policies);
  insert("claims",
    ["claim_id", "policy_id", "claim_date", "claim_amount", "claim_type", "status"],
    SEED.claims);

  return db;
}

export function getDb() {
  if (!_dbPromise) _dbPromise = buildDb();
  return _dbPromise;
}

// Run a candidate query. Returns { columns, rows } for the *last* statement
// that produces output, or { columns: [], rows: [] } if there is none.
// Throws on syntax/runtime errors.
export async function runQuery(sql) {
  const db = await getDb();
  const stmts = db.exec(sql);
  if (stmts.length === 0) return { columns: [], rows: [] };
  const last = stmts[stmts.length - 1];
  return { columns: last.columns, rows: last.values };
}
