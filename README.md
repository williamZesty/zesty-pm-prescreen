# Zesty.ai PM Pre-screen

A browser-based 20-minute screening test for Product Manager candidates. Tests basic SQL and Python (with pandas) skills before the take-home assignment.

- **No backend.** Static files only — deployable to GitHub Pages, Vercel, S3, anywhere.
- **No build step.** Vanilla HTML/CSS/JS with ES modules from CDN.
- **Code runs in the browser.** Pyodide for Python, SQL.js for SQL, CodeMirror for the editor.
- **Webhook-based submission.** Results POST to a Google Apps Script which appends to a Google Sheet.

## Local development

From the project root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The first page asks for name + email; entering both navigates to the test page.

> Pyodide is ~10 MB and is fetched lazily when the test page loads. First-time loading on a slow connection takes ~10s. SQL.js (~1 MB) loads on the first SQL run.

## GitHub Pages deployment

1. Push this repo to GitHub.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait ~1 minute. Your test will be live at `https://<user>.github.io/<repo>/`.

That's it — no actions, no build.

To deploy to Vercel instead: connect the repo, accept defaults (no framework, root output). The static files will serve as-is.

## Google Sheet + Apps Script webhook setup

The test POSTs results to a Google Apps Script web app, which appends a row to a Google Sheet.

### 1. Create the sheet

Create a new Google Sheet. In row 1, paste this header row (tab-separated; the columns must match the order written by the script):

```
timestamp	candidate_name	candidate_email	started_at	submitted_at	duration_seconds	score	q1_passed	q1_time_seconds	q1_runs	q1_paste_events	q2_passed	q2_time_seconds	q2_runs	q2_paste_events	q3_passed	q3_time_seconds	q3_runs	q3_paste_events	q4_passed	q4_time_seconds	q4_runs	q4_paste_events	tab_switches	tab_hidden_seconds	q1_code	q2_code	q3_code	q4_code
```

### 2. Create the Apps Script

In the sheet, **Extensions → Apps Script**. Replace the contents of `Code.gs` with:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const d = JSON.parse(e.postData.contents);
  sheet.appendRow([
    new Date(),
    d.candidate_name, d.candidate_email,
    d.started_at, d.submitted_at, d.duration_seconds, d.score,
    d.q1.passed, d.q1.time_seconds, d.q1.runs, d.q1.paste_events,
    d.q2.passed, d.q2.time_seconds, d.q2.runs, d.q2.paste_events,
    d.q3.passed, d.q3.time_seconds, d.q3.runs, d.q3.paste_events,
    d.q4.passed, d.q4.time_seconds, d.q4.runs, d.q4.paste_events,
    d.tab_switches, d.tab_hidden_seconds,
    d.q1.code, d.q2.code, d.q3.code, d.q4.code
  ]);
  return ContentService.createTextOutput(JSON.stringify({ok: true}))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Save the project (give it any name, e.g. "Zesty pre-screen webhook").

### 3. Deploy as a web app

1. Click **Deploy → New deployment** (gear icon → Web app).
2. **Execute as:** Me (your account).
3. **Who has access:** Anyone with the link.
4. **Deploy** — authorize when prompted, then copy the web app URL (it looks like `https://script.google.com/macros/s/AKfy.../exec`).

### 4. Wire up the URL

Open [`js/submit.js`](js/submit.js) and replace the placeholder:

```js
export const WEBHOOK_URL = "https://script.google.com/macros/s/AKfy.../exec";
```

Commit and redeploy. New submissions will land in your sheet.

> **Note on CORS:** the request uses `mode: "no-cors"` so the browser sends the body without a preflight, but you can't read the response status. That's fine — we just need the row appended. If `WEBHOOK_URL` is left as the placeholder (`XXXXXX`), the submit.js helper logs the payload to console and skips the POST so local development still works.

## How the grader works

- Seed data and expected outputs are pre-computed by [`scripts/generate_seed.py`](scripts/generate_seed.py) and embedded in [`js/seed.js`](js/seed.js). The same source data feeds both the SQLite database (for SQL questions) and the pandas DataFrames (for Python questions), so they stay in sync.
- SQL grading lives in [`js/grader.js`](js/grader.js): exact column order + row order match, with a small float tolerance.
- Python grading lives in [`js/runner-python.js`](js/runner-python.js) (`gradePython`): runs inside Pyodide using `DataFrame.equals` after `reset_index`, with `np.allclose` tolerance for Q4's loss ratios.
- Candidates can run their code as many times as they want; only the **last submitted state** counts.

## Updating questions for future rotations

Three places to edit:

1. [`js/questions.js`](js/questions.js) — prompt text, language, suggested time, starter code.
2. [`scripts/generate_seed.py`](scripts/generate_seed.py) — if you change the data shape or want fresh seed values, edit and re-run:
   ```bash
   python3 scripts/generate_seed.py
   python3 -c "import json; d=json.load(open('scripts/seed_output.json')); \
       open('js/seed.js','w').write(\
         '// Auto-generated.\nexport const SEED = ' + json.dumps({'properties':d['properties'],'policies':d['policies'],'claims':d['claims']},separators=(',',':')) + \
         ';\n\nexport const EXPECTED = ' + json.dumps(d['expected'],separators=(',',':')) + ';\n')"
   ```
   (Or just re-run the generator and copy the JSON into `js/seed.js` by hand — both work.)
3. If you add a new question, also update [`js/app.js`](js/app.js) only if you change the number of questions (the score string and Apps Script header row will need bumping).

## Telemetry captured

Per session:
- `started_at`, `submitted_at`, `duration_seconds`
- `tab_switches` (count)
- `tab_hidden_seconds` (cumulative)
- `score` (e.g. `"3/4"`)

Per question (`q1`–`q4`):
- `passed` (boolean — last run's grade)
- `code` (final state at submit)
- `time_seconds` (active panel time)
- `runs` (Run-button presses)
- `paste_events` (paste events on the editor with text > 20 chars)

This is a **filter, not a fortress** — candidates may use LLMs, and pasted answers will pass auto-grading. The hiring manager reviews telemetry alongside scores to spot suspicious sessions.

## File layout

```
/
├── index.html           Landing page (name + email)
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
│   └── submit.js        POST to Apps Script webhook
├── /scripts
│   ├── generate_seed.py Generator for seed data + expected outputs
│   └── seed_output.json Generator output (intermediate, checked in)
└── README.md
```

## Notes & deviations from the spec

- **CodeMirror 5 instead of 6.** CM6 is designed for bundlers; using it via ESM CDN requires careful version pinning of peer deps (`@codemirror/state`, `@codemirror/view`) which made the build feel less like "no build step." CM5 ships pre-bundled, supports SQL + Python modes, and exposes paste events — no functional loss for this use case.
- **Q2 seed quirk.** With the current seed, all five states have at least one claim, so an `INNER JOIN` produces the same answer as a `LEFT JOIN`. The auto-grader will mark both correct; a human reviewer can spot the difference in the candidate's code. Fine for an MVP filter.
