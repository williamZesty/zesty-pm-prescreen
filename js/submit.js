// Posts the final test payload to a Google Apps Script web app, which
// appends a row to a Google Sheet. See README for setup instructions.

// TODO: Paste your Google Apps Script web app URL here.
export const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycby2moRVFb5GYSPGkaPF2kN-rx0F6bztJUk2iLpfJAECz8KvjDQnBUjU4zE1RDUqKPUk0g/exec";

export async function submitResults(payload) {
  if (!WEBHOOK_URL || WEBHOOK_URL.includes("XXXXXX")) {
    console.warn("[submit] WEBHOOK_URL not configured — skipping POST. Payload:", payload);
    return { ok: false, reason: "not_configured" };
  }
  try {
    // Apps Script requires a "simple" request to avoid CORS preflight; sending
    // text/plain with a JSON body works and `e.postData.contents` parses fine.
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[submit] POST failed:", err);
    return { ok: false, reason: String(err) };
  }
}
