// Pyodide runner — loads the Python WASM runtime, seeds DataFrames,
// runs candidate code, and grades the resulting `result` variable.

import { SEED, EXPECTED } from "./seed.js";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

let _pyodidePromise = null;
let _seeded = false;

async function loadPyodideRuntime() {
  if (typeof window.loadPyodide !== "function") {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PYODIDE_CDN + "pyodide.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load pyodide.js"));
      document.head.appendChild(s);
    });
  }
  const pyodide = await window.loadPyodide({ indexURL: PYODIDE_CDN });
  await pyodide.loadPackage(["pandas", "numpy"]);
  return pyodide;
}

async function getPyodide() {
  if (!_pyodidePromise) _pyodidePromise = loadPyodideRuntime();
  const pyodide = await _pyodidePromise;
  if (!_seeded) {
    pyodide.globals.set("_seed_json", JSON.stringify({
      properties: SEED.properties,
      policies: SEED.policies,
      claims: SEED.claims,
    }));
    pyodide.runPython(`
import json
import pandas as pd
import numpy as np

_seed = json.loads(_seed_json)
properties_df = pd.DataFrame(_seed["properties"])
policies_df = pd.DataFrame(_seed["policies"])
claims_df = pd.DataFrame(_seed["claims"])
del _seed
del _seed_json
`);
    _seeded = true;
  }
  return pyodide;
}

// Eagerly start loading + seeding; callers can await readiness via `getPyodide()`.
export function preloadPyodide() {
  // Fire-and-forget: triggers runtime download, package install, and DataFrame
  // seeding so Q3/Q4 are instant when the candidate gets there.
  getPyodide().catch((e) => console.error("[pyodide] preload failed:", e));
}

export function isReady() {
  return _seeded;
}

// Run candidate code. Returns:
//   { stdout, hasResult, resultPreview, resultColumns, resultRowCount }
// Throws on Python errors (caller should display the message).
export async function runCode(code) {
  const pyodide = await getPyodide();
  // Reset stdout/stderr capture and `result` for each run.
  pyodide.runPython(`
import io, sys
_buf = io.StringIO()
sys.stdout = _buf
sys.stderr = _buf
try:
    del result
except NameError:
    pass
`);

  let pyError = null;
  try {
    pyodide.runPython(code);
  } catch (e) {
    pyError = e;
  }

  // Even on error, capture whatever was printed before the exception.
  const stdout = pyodide.runPython("sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__; _buf.getvalue()");

  if (pyError) {
    const msg = String(pyError.message || pyError);
    throw new Error(stdout + (stdout && !stdout.endsWith("\n") ? "\n" : "") + msg);
  }

  const hasResult = pyodide.runPython("'result' in dir()");
  let resultColumns = null;
  let resultRowCount = null;
  let resultPreview = null;
  if (hasResult) {
    pyodide.runPython(`
def _summarize_result(r):
    import pandas as pd
    if isinstance(r, pd.DataFrame):
        cols = list(r.columns)
        n = len(r)
        preview = r.head(10).to_string(index=False)
        return cols, n, preview
    elif isinstance(r, pd.Series):
        return [r.name or "<series>"], len(r), r.head(10).to_string()
    else:
        return None, None, repr(r)[:1000]

_cols, _n, _preview = _summarize_result(result)
`);
    const cols = pyodide.globals.get("_cols");
    resultColumns = cols ? cols.toJs() : null;
    resultRowCount = pyodide.globals.get("_n");
    resultPreview = pyodide.globals.get("_preview");
  }

  return { stdout, hasResult, resultColumns, resultRowCount, resultPreview };
}

// Compare candidate `result` against the expected DataFrame for `qid`
// (q3 or q4). Done inside Pyodide so we get pandas semantics.
export async function gradePython(qid) {
  const pyodide = await getPyodide();
  const expected = EXPECTED[qid];
  if (!expected) throw new Error(`No expected output for ${qid}`);

  pyodide.globals.set("_expected_json", JSON.stringify(expected));
  pyodide.globals.set("_qid", qid);
  pyodide.runPython(`
import json
import pandas as pd
import numpy as np

_exp = json.loads(_expected_json)
_expected_df = pd.DataFrame(_exp["rows"], columns=_exp["columns"])

_grade = {"passed": False, "hint": None}

if "result" not in dir():
    _grade["hint"] = "No variable named 'result' was assigned. Make sure your code ends with 'result = ...'."
elif not isinstance(result, pd.DataFrame):
    _grade["hint"] = f"'result' should be a DataFrame, got {type(result).__name__}."
else:
    _r = result.reset_index(drop=True)
    _e = _expected_df.reset_index(drop=True)

    if list(_r.columns) != list(_e.columns):
        _grade["hint"] = (
            f"Column names/order differ. Expected {list(_e.columns)}, got {list(_r.columns)}."
        )
    elif len(_r) != len(_e):
        _grade["hint"] = (
            f"Row count differs. Expected {len(_e)} rows, got {len(_r)} — check your filters or grouping."
        )
    else:
        # For Q4 we tolerate float drift on loss_ratio.
        if _qid == "q4":
            try:
                ids_match = (_r["policy_id"].astype(int).tolist() == _e["policy_id"].astype(int).tolist())
                ratios_match = bool(np.allclose(
                    _r["loss_ratio"].astype(float).to_numpy(),
                    _e["loss_ratio"].astype(float).to_numpy(),
                    rtol=1e-6, atol=1e-6,
                ))
                if ids_match and ratios_match:
                    _grade["passed"] = True
                elif not ids_match:
                    _grade["hint"] = "Policy IDs are in the wrong order — did you sort by loss_ratio descending?"
                else:
                    _grade["hint"] = "Loss ratio values don't match — check your aggregation and division."
            except Exception as _err:
                _grade["hint"] = f"Could not compare values: {_err}"
        else:
            try:
                if _r.equals(_e):
                    _grade["passed"] = True
                else:
                    # Try element-wise comparison ignoring dtype.
                    same = (_r.astype(str).reset_index(drop=True)
                            .equals(_e.astype(str).reset_index(drop=True)))
                    if same:
                        _grade["passed"] = True
                    else:
                        _grade["hint"] = "Row count and columns match but values differ — check your filter conditions."
            except Exception as _err:
                _grade["hint"] = f"Could not compare values: {_err}"

del _exp
del _expected_df
del _expected_json
del _qid
`);
  const passed = pyodide.runPython("_grade['passed']");
  const hint = pyodide.runPython("_grade['hint']");
  return { passed: !!passed, hint: hint || null };
}
