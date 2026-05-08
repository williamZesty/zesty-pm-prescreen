// Per-session and per-question telemetry. The hiring manager reviews this
// alongside scores to spot suspicious sessions (LLM-pasted answers,
// long tab-hidden stretches, etc.).

export class Telemetry {
  constructor(questionIds) {
    this.startedAt = new Date();
    this.tabSwitches = 0;
    this.tabHiddenSeconds = 0;
    this._hiddenAt = null;
    this.activeQid = null;
    this._activeSince = null;
    this.questions = {};
    for (const qid of questionIds) {
      this.questions[qid] = {
        timeSeconds: 0,
        runs: 0,
        pasteEvents: 0,
        code: "",
        passed: false,
      };
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.tabSwitches += 1;
        this._hiddenAt = Date.now();
      } else if (this._hiddenAt) {
        this.tabHiddenSeconds += (Date.now() - this._hiddenAt) / 1000;
        this._hiddenAt = null;
      }
    });
  }

  setActiveQuestion(qid) {
    const now = Date.now();
    if (this.activeQid && this._activeSince) {
      this.questions[this.activeQid].timeSeconds += (now - this._activeSince) / 1000;
    }
    this.activeQid = qid;
    this._activeSince = now;
  }

  // Should be called when the editor for `qid` receives a paste event with
  // pasted text length > 20 chars.
  recordPaste(qid) {
    if (this.questions[qid]) this.questions[qid].pasteEvents += 1;
  }

  recordRun(qid, code, passed) {
    const q = this.questions[qid];
    if (!q) return;
    q.runs += 1;
    q.code = code;
    q.passed = !!passed;
  }

  // Update saved code without incrementing the run counter (called on submit
  // to capture last-edited state even if candidate didn't re-run).
  saveCode(qid, code) {
    if (this.questions[qid]) this.questions[qid].code = code;
  }

  // Update pass state without incrementing runs (used when re-grading).
  setPassed(qid, passed) {
    if (this.questions[qid]) this.questions[qid].passed = !!passed;
  }

  finalize() {
    // Flush time on the active question.
    if (this.activeQid && this._activeSince) {
      this.questions[this.activeQid].timeSeconds += (Date.now() - this._activeSince) / 1000;
      this._activeSince = Date.now();
    }
    // Flush any in-progress hidden interval.
    if (this._hiddenAt) {
      this.tabHiddenSeconds += (Date.now() - this._hiddenAt) / 1000;
      this._hiddenAt = null;
    }
    const submittedAt = new Date();
    const score = Object.values(this.questions).filter((q) => q.passed).length;
    const total = Object.keys(this.questions).length;

    const payload = {
      started_at: this.startedAt.toISOString(),
      submitted_at: submittedAt.toISOString(),
      duration_seconds: Math.round((submittedAt - this.startedAt) / 1000),
      score: `${score}/${total}`,
      tab_switches: this.tabSwitches,
      tab_hidden_seconds: Math.round(this.tabHiddenSeconds),
    };
    for (const [qid, q] of Object.entries(this.questions)) {
      payload[qid] = {
        passed: q.passed,
        code: q.code,
        time_seconds: Math.round(q.timeSeconds),
        runs: q.runs,
        paste_events: q.pasteEvents,
      };
    }
    return payload;
  }
}
