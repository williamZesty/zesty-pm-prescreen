// Validates an access key against the Apps Script web app. The script
// atomically increments `uses_so_far` on the AccessKeys sheet and writes a
// row to KeyUseLog, then returns JSON.
//
// Returns one of:
//   { ok: true,  uses: <number>, max_uses: <number> }
//   { ok: false, error: "invalid_key" }
//   { ok: false, error: "max_uses_reached", uses, max_uses }
//   { ok: false, error: "network" }
//
// When WEBHOOK_URL is the placeholder we bypass validation entirely — useful
// for offline demos and local dev without a deployed script.

import { WEBHOOK_URL } from "./submit.js";

export async function validateAccessKey({ key, name, email }) {
  if (!WEBHOOK_URL || WEBHOOK_URL.includes("XXXXXX")) {
    console.warn("[access] WEBHOOK_URL not configured — bypassing validation.");
    return { ok: true, uses: 1, max_uses: 1, _bypassed: true };
  }
  const url = `${WEBHOOK_URL}?action=validate`
    + `&key=${encodeURIComponent(key)}`
    + `&name=${encodeURIComponent(name)}`
    + `&email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    if (!res.ok) {
      console.error("[access] HTTP", res.status);
      return { ok: false, error: "network" };
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      console.error("[access] non-JSON response:", text.slice(0, 200));
      return { ok: false, error: "network" };
    }
  } catch (err) {
    console.error("[access] validation failed:", err);
    return { ok: false, error: "network" };
  }
}
