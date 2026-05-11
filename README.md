# Zesty.ai PM Candidate Pre-screen

A short, browser-based screening test for Product Manager candidates at Zesty.ai. Candidates answer **4 timed questions** — 2 SQL, 2 Python (pandas) — in about 20 minutes. Auto-graded, results recorded for human review.

This repository is intentionally public so candidates and the broader community can see exactly what they're walking into.

## What it is

| | |
|---|---|
| **Purpose** | Filter for basic data fluency before the take-home assignment |
| **Duration** | 20 minutes, hard timer |
| **Format** | 2 SQL questions, 2 Python (pandas) questions |
| **Allowed** | Any reference material, including LLMs |
| **Logged** | Tab switches, paste events, time per question, runs, final code |
| **Hosting** | Static site on GitHub Pages — no server, no build step |

If you're a candidate who landed here from a test link, just take the test. We expect candidates to read the source if they want to — that's part of why this is open.

## How it works

1. Candidate opens the test page, enters an **access key** (emailed to them) plus name + email.
2. The access key is validated against a Google Sheet via a Google Apps Script web app; the script atomically increments a per-key usage counter (default max 3 attempts per key).
3. On success, the candidate gets 20 minutes to answer 4 questions in an in-browser editor. SQL runs against SQLite-WASM ([SQL.js](https://sql.js.org/)); Python runs against [Pyodide](https://pyodide.org/) with pandas.
4. Each question's output is compared to a pre-computed expected result; a candidate can run as many times as they want.
5. On submit (or timeout), results + telemetry POST to the same Apps Script, which appends a row to a Google Sheet.

## Tech stack

- Vanilla HTML / CSS / ES modules — no framework, no bundler
- [SQL.js](https://sql.js.org/) (SQLite compiled to WASM) from cdnjs
- [Pyodide](https://pyodide.org/) (CPython compiled to WASM, with pandas + numpy) from jsdelivr
- [CodeMirror 5](https://codemirror.net/5/) from cdnjs
- [Google Apps Script](https://developers.google.com/apps-script) web app as the backend, writing to a Google Sheet

## Security & threat model

Because this repo is public, the entire client is inspectable. We've designed the test to **filter, not fortify**. Specifically:

| Risk | Mitigation |
|---|---|
| **A candidate inspects the page source to find the expected answers.** All 4 expected outputs are embedded in [`js/seed.js`](js/seed.js) so the grader can compare client-side. A determined candidate can read them and hardcode their queries (e.g. `SELECT 16 AS claim_id, 47280.02 AS claim_amount, …`). | Telemetry captures their final code; hiring manager reviews suspicious sessions. Hardcoded answers are obvious on read. For a stricter setup, the expected outputs can be moved server-side into the Apps Script — see "Hardening options" below. |
| **A candidate uses an LLM to draft answers.** Explicitly allowed — Zesty values working with AI tools. Paste events and time-per-question are logged so reviewers can distinguish "used an LLM as a reference" from "pasted an answer wholesale." | None needed — this is part of the design. |
| **The webhook URL is in the public source.** Anyone with the URL can spam the Submissions sheet or probe access keys. | The Apps Script writes to dedicated tabs only and never reads back. Probing for valid keys is detectable in the `KeyUseLog` (every attempt logged with status). If the URL is being abused, redeploy the Apps Script as a new version — the path changes. |
| **A candidate brute-forces access keys.** The validate endpoint returns `invalid_key` vs `ok`/`max_uses_reached`, which is an enumeration oracle. | Use unguessable keys (UUIDs or random 16+ char strings) when issuing them. The `helloworld` key shown in development docs is **not** suitable for production. |
| **CDN supply-chain compromise.** SQL.js, Pyodide, and CodeMirror load from public CDNs without [SRI](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) hashes. A compromised CDN could inject code into a candidate's browser. | Acceptable for a low-volume hiring tool with no Zesty data on-page. Add SRI hashes for hardening if needed. |
| **Pyodide / SQL.js sandbox escape.** Candidate code runs in WASM sandboxes that cannot access the host filesystem or network beyond what the page exposes. | The host page exposes only the seed dataset and the candidate's own `result` variable — no Zesty data is reachable from candidate code. |
| **PII handling.** Candidate name + email + final code are written to the Google Sheet for hiring use. | Same governance as any hiring funnel data. The Sheet should be access-restricted to the hiring team. |

### What an attacker *cannot* do

- Read the Submissions sheet via the public webhook — the Apps Script only writes.
- Read the list of valid access keys — `validate` confirms a key but doesn't enumerate.
- Reach any Zesty-internal data — none is referenced by this codebase.
- Modify the live test in someone else's browser — the static files are immutable per deploy.

### Hardening options if you fork this

- **Server-side grading.** Move `EXPECTED` from `js/seed.js` into the Apps Script. Have the grader POST the candidate's output and receive pass/fail. Closes the answer-leak gap but adds ~1s latency per Run.
- **SRI on CDN scripts.** Add `integrity="sha384-…"` to the CodeMirror and SQL.js script tags in `test.html`. Pyodide loads dynamically and is harder to pin.
- **Stronger key entropy.** Generate access keys with `crypto.randomUUID()` or a 16-character random string. Document in the `label` column who got it.
- **Content Security Policy.** Add `<meta http-equiv="Content-Security-Policy" content="…">` to lock down what scripts/styles can load. Pyodide needs `'unsafe-eval'`.

## For Zesty hiring managers

### Issuing an access key

1. Open the Google Sheet → **`AccessKeys`** tab.
2. Add a row: `key | label | max_uses | (leave the rest blank)`.
   - `key`: any string. Pick something unguessable — e.g. `ZESTY-W19-9f3a` rather than `ZESTY-001`.
   - `label`: a note for you, e.g. "Sent to Sarah Smith on 2026-05-11".
   - `max_uses`: default `3`. Allows a typo retry.
3. Email the candidate the key plus the test URL.
4. Results land in the **`Submissions`** tab; every validate attempt lands in **`KeyUseLog`**.

### Reviewing results

The **`Submissions`** tab has one row per completed test. Useful columns:

- `score` (e.g. `3/4`)
- `q1_paste_events`, `q1_time_seconds`, `q1_runs` — patterns to scan for:
  - High paste events + short time + low run count + passing = likely pasted answer
  - Zero paste events + many runs + medium time + passing = genuine work
- `q1_code`, `q2_code`, `q3_code`, `q4_code` — the candidate's actual code at submit

The **`KeyUseLog`** tab has one row per validate attempt. Scan for:

- `status = denied`, `reason = invalid_key` — someone probing or mistyping
- Same `key` with multiple distinct `email` values — a candidate burning attempts on fake emails

## For developers / forkers

### Local development

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. When `WEBHOOK_URL` is the placeholder (the default), access-key validation is bypassed and submissions log to console — no Google setup needed for local work.

> Pyodide is ~10 MB and is fetched lazily when the test page loads. First load on a slow connection takes ~10s. SQL.js (~1 MB) loads on the first SQL run.

### GitHub Pages deployment

1. Push to a public GitHub repo.
2. **Settings → Pages → Source:** Deploy from a branch, branch `main`, folder `/ (root)`.
3. Wait ~1 minute. Test is live at `https://<user>.github.io/<repo>/`.

No build step, no CI required. (GitHub Pages on private repos requires a paid plan; using a public repo is also why we put the threat model up top.)

### Google Sheet + Apps Script setup

The same Apps Script web app handles two actions:

| Action | HTTP | Used for |
|---|---|---|
| `validate` | `GET` | Check an access key and atomically increment its usage counter |
| `submit`   | `POST` | Append a result row when the candidate submits the test |

#### 1. Create the Google Sheet with three tabs

Make a new Google Sheet, then create three tabs with these exact names and header rows.

**Tab 1: `Submissions`** (rename the default `Sheet1`). Paste this header row:

```
timestamp	candidate_name	candidate_email	access_key	started_at	submitted_at	duration_seconds	score	q1_passed	q1_time_seconds	q1_runs	q1_paste_events	q2_passed	q2_time_seconds	q2_runs	q2_paste_events	q3_passed	q3_time_seconds	q3_runs	q3_paste_events	q4_passed	q4_time_seconds	q4_runs	q4_paste_events	tab_switches	tab_hidden_seconds	q1_code	q2_code	q3_code	q4_code
```

**Tab 2: `AccessKeys`** — the lookup table you maintain by hand. The script reads columns by name, so column order doesn't matter as long as the names match.

```
key	label	max_uses	uses_so_far	last_used_at	last_used_email
```

Leave `uses_so_far`, `last_used_at`, and `last_used_email` blank when adding new keys — the script fills them in.

**Tab 3: `KeyUseLog`** — auto-appended audit trail. The script populates it; you just need the header row:

```
timestamp	key	name	email	status	reason	uses	max_uses
```

#### 2. Paste the Apps Script

In the sheet, **Extensions → Apps Script**. Replace the contents of `Code.gs` with:

```javascript
const SHEETS = {
  submissions: "Submissions",
  keys: "AccessKeys",
  log: "KeyUseLog",
};
const DEFAULT_MAX_USES = 3;

function doGet(e) {
  if (e.parameter.action === "validate") {
    return validateKey(e.parameter);
  }
  return jsonResponse({ok: false, error: "unknown_action"});
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.action && d.action !== "submit") {
    return jsonResponse({ok: false, error: "unknown_action"});
  }
  return saveSubmission(d);
}

function saveSubmission(d) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.submissions);
  if (!sheet) return jsonResponse({ok: false, error: "submissions_sheet_missing"});
  sheet.appendRow([
    new Date(),
    d.candidate_name, d.candidate_email, d.access_key || "",
    d.started_at, d.submitted_at, d.duration_seconds, d.score,
    d.q1.passed, d.q1.time_seconds, d.q1.runs, d.q1.paste_events,
    d.q2.passed, d.q2.time_seconds, d.q2.runs, d.q2.paste_events,
    d.q3.passed, d.q3.time_seconds, d.q3.runs, d.q3.paste_events,
    d.q4.passed, d.q4.time_seconds, d.q4.runs, d.q4.paste_events,
    d.tab_switches, d.tab_hidden_seconds,
    d.q1.code, d.q2.code, d.q3.code, d.q4.code
  ]);
  return jsonResponse({ok: true});
}

function validateKey(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const keysSheet = ss.getSheetByName(SHEETS.keys);
    if (!keysSheet) return jsonResponse({ok: false, error: "keys_sheet_missing"});

    const data = keysSheet.getDataRange().getValues();
    if (data.length < 1) return jsonResponse({ok: false, error: "keys_sheet_empty"});

    const headers = data[0].map(String);
    const col = {
      key: headers.indexOf("key"),
      max: headers.indexOf("max_uses"),
      used: headers.indexOf("uses_so_far"),
      lastAt: headers.indexOf("last_used_at"),
      lastEmail: headers.indexOf("last_used_email"),
    };
    if (col.key < 0 || col.used < 0) {
      return jsonResponse({ok: false, error: "keys_sheet_columns_missing"});
    }

    const target = String(p.key || "").trim();
    for (let i = 1; i < data.length; i++) {
      const rowKey = String(data[i][col.key] || "").trim();
      if (rowKey && rowKey === target) {
        const max = col.max >= 0 ? (Number(data[i][col.max]) || DEFAULT_MAX_USES) : DEFAULT_MAX_USES;
        const used = Number(data[i][col.used]) || 0;
        if (used >= max) {
          logUse(ss, p, "denied", "max_uses_reached", used, max);
          return jsonResponse({ok: false, error: "max_uses_reached", uses: used, max_uses: max});
        }
        const newUsed = used + 1;
        keysSheet.getRange(i + 1, col.used + 1).setValue(newUsed);
        if (col.lastAt >= 0)    keysSheet.getRange(i + 1, col.lastAt + 1).setValue(new Date());
        if (col.lastEmail >= 0) keysSheet.getRange(i + 1, col.lastEmail + 1).setValue(p.email || "");
        SpreadsheetApp.flush();
        logUse(ss, p, "allowed", newUsed + "/" + max, newUsed, max);
        return jsonResponse({ok: true, uses: newUsed, max_uses: max});
      }
    }
    logUse(ss, p, "denied", "invalid_key", 0, 0);
    return jsonResponse({ok: false, error: "invalid_key"});
  } finally {
    lock.releaseLock();
  }
}

function logUse(ss, p, status, reason, uses, max) {
  const logSheet = ss.getSheetByName(SHEETS.log);
  if (!logSheet) return;
  logSheet.appendRow([
    new Date(),
    p.key || "",
    p.name || "",
    p.email || "",
    status,
    reason,
    uses,
    max,
  ]);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Save the project.

#### 3. Deploy as a web app

1. **Deploy → New deployment** (gear icon → Web app).
2. **Execute as:** Me (your account).
3. **Who has access:** Anyone with the link.
4. **Deploy**, authorize, copy the web app URL (`https://script.google.com/macros/s/AKfy…/exec`).

> When you update the script later, click **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** to push changes. The URL stays the same.

#### 4. Wire up the URL

Open [`js/submit.js`](js/submit.js) and set:

```js
export const WEBHOOK_URL = "https://script.google.com/macros/s/AKfy…/exec";
```

Both [`js/submit.js`](js/submit.js) (POST submissions) and [`js/access.js`](js/access.js) read the same constant.

> **CORS:** validation uses `fetch(url)` and reads the JSON response — Apps Script returns CORS headers on `doGet` responses so this works cross-origin. Submission uses `mode: "no-cors"` because that path doesn't need to read the response. If `WEBHOOK_URL` is the placeholder, both helpers log to console and skip the network call (validation accepts any key), so local dev works with no setup.

### How the grader works

- Seed data and expected outputs are pre-computed by [`scripts/generate_seed.py`](scripts/generate_seed.py) and embedded in [`js/seed.js`](js/seed.js). The same source data feeds both the SQLite database (for SQL questions) and the pandas DataFrames (for Python questions), so they stay in sync.
- SQL grading lives in [`js/grader.js`](js/grader.js): exact column order + row order match, with a small float tolerance.
- Python grading lives in [`js/runner-python.js`](js/runner-python.js) (`gradePython`): runs inside Pyodide using `DataFrame.equals` after `reset_index`, with `np.allclose` tolerance for Q4's loss ratios.
- Candidates can run their code as many times as they want; only the **last submitted state** counts.

### Updating questions for future rotations

1. Edit prompts and starter code in [`js/questions.js`](js/questions.js).
2. If you change the data shape, edit and re-run [`scripts/generate_seed.py`](scripts/generate_seed.py); copy the JSON into [`js/seed.js`](js/seed.js).
3. If you change the *number* of questions, also update [`js/app.js`](js/app.js) and the Apps Script's `appendRow` columns + the Submissions header row.

### Telemetry captured

Per session:
- `started_at`, `submitted_at`, `duration_seconds`
- `tab_switches` (count of `visibilitychange` events where `document.hidden` becomes true)
- `tab_hidden_seconds` (cumulative)
- `score` (e.g. `"3/4"`)

Per question (`q1`–`q4`):
- `passed` — last run's grade
- `code` — final state at submit
- `time_seconds` — active panel time
- `runs` — Run-button presses
- `paste_events` — paste events on the editor with text > 20 chars

### File layout

```
/
├── index.html           Landing page (access key + name + email)
├── test.html            Test runner
├── done.html            Submission confirmation
├── /css/styles.css
├── /js
│   ├── app.js           Test-page controller (timer, nav, run, submit)
│   ├── questions.js     Question prompts + schema reference text
│   ├── seed.js          Seed data + expected outputs (auto-generated)
│   ├── runner-sql.js    SQL.js wrapper
│   ├── runner-python.js Pyodide wrapper
│   ├── grader.js        SQL output comparison (Python lives in runner)
│   ├── telemetry.js     Tab/paste/time tracking
│   ├── access.js        GET validate to Apps Script (access keys)
│   └── submit.js        POST to Apps Script webhook
├── /scripts
│   ├── generate_seed.py Generator for seed data + expected outputs
│   └── seed_output.json Generator output (intermediate, checked in)
└── README.md
```

### Notes & deviations from the original spec

- **CodeMirror 5 instead of 6.** CM6 is designed for bundlers; using it via ESM CDN requires careful version pinning of peer deps. CM5 ships pre-bundled and satisfies the no-build constraint cleanly — no functional loss for SQL + Python editing with paste events.
- **Q2 seed quirk.** With the current seed, all five states have at least one claim, so an `INNER JOIN` produces the same answer as a `LEFT JOIN`. The auto-grader marks both correct; a human reviewer can spot the difference in the candidate's code.

## License

MIT. Fork it, adapt it, run your own version.
