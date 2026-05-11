// Test-page controller. Wires the timer, question navigation, code editor,
// run+grade flow, telemetry, and submit. Loaded as a module from test.html.

import { QUESTIONS, SCHEMA_REFERENCE } from "./questions.js";
import { runQuery } from "./runner-sql.js";
import { runCode, gradePython, preloadPyodide, isReady as pyReady } from "./runner-python.js";
import { gradeSql } from "./grader.js";
import { Telemetry } from "./telemetry.js";
import { submitResults } from "./submit.js";

const TEST_DURATION_SECONDS = 20 * 60;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tiny markdown-ish renderer — just enough for our prompts (bold, code, lists).
function renderPrompt(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  for (const raw of lines) {
    let line = escapeHtml(raw);
    line = line.replace(/`([^`]+)`/g, "<code>$1</code>");
    line = line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    if (/^\s*\d+\.\s+/.test(raw) || /^\s*[-*]\s+/.test(raw)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^\s*(\d+\.|[-*])\s+/, "")}</li>`;
    } else if (raw.trim() === "") {
      if (inList) { html += "</ul>"; inList = false; }
      html += "<p></p>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${line}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function renderTable(columns, rows, maxRows = 50) {
  if (!columns || columns.length === 0) return "<em>(no result set)</em>";
  let html = "<table class='result-table'><thead><tr>";
  for (const c of columns) html += `<th>${escapeHtml(c)}</th>`;
  html += "</tr></thead><tbody>";
  const display = rows.slice(0, maxRows);
  for (const row of display) {
    html += "<tr>";
    for (const v of row) html += `<td>${escapeHtml(v)}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  if (rows.length > maxRows) {
    html += `<p class="result-note">…showing first ${maxRows} of ${rows.length} rows.</p>`;
  } else {
    html += `<p class="result-note">${rows.length} row${rows.length === 1 ? "" : "s"}.</p>`;
  }
  return html;
}

class App {
  constructor() {
    this.candidate = {
      name: sessionStorage.getItem("candidate_name") || "",
      email: sessionStorage.getItem("candidate_email") || "",
      access_key: sessionStorage.getItem("access_key") || "",
    };
    if (!this.candidate.name || !this.candidate.email || !this.candidate.access_key) {
      // No candidate info / unvalidated key — kick back to landing.
      window.location.replace("index.html");
      return;
    }

    this.telemetry = new Telemetry(QUESTIONS.map((q) => q.id));
    this.editors = {}; // qid -> CodeMirror instance
    this.codeByQid = {}; // qid -> latest code (mirrored from editors on switch)
    this.statusByQid = {}; // qid -> "untouched" | "in_progress" | "passed" | "failed"
    this.lastResultByQid = {}; // qid -> { html, verdictHtml }
    this.activeQid = QUESTIONS[0].id;
    this.timerEnd = Date.now() + TEST_DURATION_SECONDS * 1000;
    this.submitting = false;

    for (const q of QUESTIONS) {
      this.codeByQid[q.id] = q.starter;
      this.statusByQid[q.id] = "untouched";
    }
  }

  init() {
    $("#candidate-name").textContent = this.candidate.name;
    $("#schema-reference").textContent = SCHEMA_REFERENCE;
    this.renderQuestionList();
    this.renderActiveQuestion();
    this.startTimer();

    $("#run-btn").addEventListener("click", () => this.handleRun());
    $("#submit-btn").addEventListener("click", () => this.handleSubmit(false));

    // Eagerly start Pyodide; it's ~10MB and we want it warm before Q3.
    preloadPyodide();
    this.pollPyStatus();

    this.telemetry.setActiveQuestion(this.activeQid);

    // Warn on accidental navigation away.
    window.addEventListener("beforeunload", (e) => {
      if (!this.submitting) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  pollPyStatus() {
    const ind = $("#py-status");
    const update = () => {
      if (pyReady()) {
        ind.textContent = "Python ready";
        ind.classList.add("ready");
      } else {
        ind.textContent = "Python loading…";
        setTimeout(update, 500);
      }
    };
    update();
  }

  renderQuestionList() {
    const ul = $("#question-list");
    ul.innerHTML = "";
    QUESTIONS.forEach((q, i) => {
      const li = document.createElement("li");
      li.dataset.qid = q.id;
      li.classList.toggle("active", q.id === this.activeQid);
      li.classList.add(`status-${this.statusByQid[q.id]}`);
      const icon = {
        untouched: "○",
        in_progress: "●",
        passed: "✓",
        failed: "✗",
      }[this.statusByQid[q.id]];
      li.innerHTML = `
        <span class="q-icon">${icon}</span>
        <span class="q-title">Q${i + 1} <span class="q-lang">${q.language.toUpperCase()}</span></span>
        <span class="q-time">~${q.suggestedMinutes} min</span>
      `;
      li.addEventListener("click", () => this.switchQuestion(q.id));
      ul.appendChild(li);
    });
  }

  renderActiveQuestion() {
    const q = QUESTIONS.find((x) => x.id === this.activeQid);
    $("#question-title").textContent = q.title;
    $("#question-prompt").innerHTML = renderPrompt(q.prompt);

    // Tear down previous editor and rebuild — keeps CM5 simple per-question.
    const host = $("#editor-host");
    host.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.value = this.codeByQid[q.id];
    host.appendChild(ta);

    const mode = q.language === "sql" ? "text/x-sql" : "text/x-python";
    const editor = window.CodeMirror.fromTextArea(ta, {
      lineNumbers: true,
      mode,
      indentUnit: q.language === "python" ? 4 : 2,
      tabSize: q.language === "python" ? 4 : 2,
      lineWrapping: false,
      theme: "default",
    });
    editor.setSize("100%", "100%");
    editor.on("change", () => {
      this.codeByQid[q.id] = editor.getValue();
      if (this.statusByQid[q.id] === "untouched") {
        this.statusByQid[q.id] = "in_progress";
        this.renderQuestionList();
      }
    });
    editor.on("paste", (_cm, e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
      if (text.length > 20) this.telemetry.recordPaste(q.id);
    });
    this.editors[q.id] = editor;

    // Restore last run output if any.
    const last = this.lastResultByQid[q.id];
    if (last) {
      $("#result-area").innerHTML = last.html;
      $("#verdict").innerHTML = last.verdictHtml;
    } else {
      $("#result-area").innerHTML = `<p class="placeholder">Click Run to execute your ${q.language === "sql" ? "query" : "code"}.</p>`;
      $("#verdict").innerHTML = "";
    }
  }

  switchQuestion(qid) {
    if (qid === this.activeQid) return;
    // Persist current editor state.
    const cur = this.editors[this.activeQid];
    if (cur) this.codeByQid[this.activeQid] = cur.getValue();

    this.telemetry.setActiveQuestion(qid);
    this.activeQid = qid;
    this.renderQuestionList();
    this.renderActiveQuestion();
  }

  async handleRun() {
    const qid = this.activeQid;
    const q = QUESTIONS.find((x) => x.id === qid);
    const code = this.editors[qid].getValue();
    this.codeByQid[qid] = code;

    const runBtn = $("#run-btn");
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    $("#result-area").innerHTML = "<p class='placeholder'>Running…</p>";
    $("#verdict").innerHTML = "";

    let passed = false;
    try {
      if (q.language === "sql") {
        const result = await runQuery(code);
        $("#result-area").innerHTML = renderTable(result.columns, result.rows);
        const grade = gradeSql(qid, result);
        passed = grade.passed;
        $("#verdict").innerHTML = grade.passed
          ? `<div class="verdict verdict-pass">✓ Output matches expected.</div>`
          : `<div class="verdict verdict-fail">✗ ${escapeHtml(grade.hint || "Output doesn't match expected.")}</div>`;
      } else {
        const out = await runCode(code);
        let html = "";
        if (out.stdout) {
          html += `<h4>stdout</h4><pre class="stdout">${escapeHtml(out.stdout)}</pre>`;
        }
        if (out.hasResult) {
          html += `<h4>result</h4>`;
          const colsStr = out.resultColumns ? out.resultColumns.map(escapeHtml).join(", ") : "n/a";
          html += `<p class="result-note">DataFrame with ${out.resultRowCount} row${out.resultRowCount === 1 ? "" : "s"}, columns: ${colsStr}</p>`;
          html += `<pre class="result-preview">${escapeHtml(out.resultPreview || "")}</pre>`;
        } else {
          html += `<p class="result-note">No <code>result</code> variable was assigned.</p>`;
        }
        $("#result-area").innerHTML = html || "<p class='placeholder'>(no output)</p>";

        const grade = await gradePython(qid);
        passed = grade.passed;
        $("#verdict").innerHTML = grade.passed
          ? `<div class="verdict verdict-pass">✓ Output matches expected.</div>`
          : `<div class="verdict verdict-fail">✗ ${escapeHtml(grade.hint || "Output doesn't match expected.")}</div>`;
      }
    } catch (err) {
      $("#result-area").innerHTML = `<h4>Error</h4><pre class="stderr">${escapeHtml(err.message || String(err))}</pre>`;
      $("#verdict").innerHTML = `<div class="verdict verdict-fail">✗ Code raised an error — fix it and run again.</div>`;
      passed = false;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Run";
    }

    this.statusByQid[qid] = passed ? "passed" : "failed";
    this.telemetry.recordRun(qid, code, passed);
    this.lastResultByQid[qid] = {
      html: $("#result-area").innerHTML,
      verdictHtml: $("#verdict").innerHTML,
    };
    this.renderQuestionList();
  }

  startTimer() {
    const tick = () => {
      const remaining = (this.timerEnd - Date.now()) / 1000;
      $("#timer").textContent = formatTime(remaining);
      $("#timer").classList.toggle("warning", remaining <= 60 && remaining > 0);
      if (remaining <= 0) {
        $("#timer").textContent = "0:00";
        this.handleSubmit(true);
        return;
      }
      this._timerHandle = setTimeout(tick, 500);
    };
    tick();
  }

  async handleSubmit(auto) {
    if (this.submitting) return;
    if (!auto) {
      const ok = window.confirm(
        "Submit your test? You won't be able to make further changes.",
      );
      if (!ok) return;
    }
    this.submitting = true;
    if (this._timerHandle) clearTimeout(this._timerHandle);

    // Snapshot final editor states.
    for (const [qid, ed] of Object.entries(this.editors)) {
      this.codeByQid[qid] = ed.getValue();
      this.telemetry.saveCode(qid, ed.getValue());
    }

    const submitBtn = $("#submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const partial = this.telemetry.finalize();
    const payload = {
      candidate_name: this.candidate.name,
      candidate_email: this.candidate.email,
      access_key: this.candidate.access_key,
      ...partial,
    };

    try {
      await submitResults(payload);
    } catch (err) {
      console.error("Submit error:", err);
    }

    sessionStorage.removeItem("candidate_name");
    sessionStorage.removeItem("candidate_email");
    sessionStorage.removeItem("access_key");
    sessionStorage.removeItem("access_uses");
    sessionStorage.removeItem("access_max_uses");
    window.location.replace("done.html");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new App();
  if (app.candidate && app.candidate.name) app.init();
});
