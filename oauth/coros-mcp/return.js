"use strict";

const incoming = new URL(window.location.href);
window.history.replaceState(null, "", incoming.pathname);
const status = document.getElementById("status");
const link = document.getElementById("open-app");
const params = incoming.searchParams;
const state = params.get("state");
const code = params.get("code");
const error = params.get("error");
const validState = params.getAll("state").length === 1 && /^[A-Za-z0-9_-]{43}$/.test(state ?? "");
const validCode = params.getAll("code").length === 1 && code !== null && code.length > 0 && code.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(code) && !params.has("error");
const validError = params.getAll("error").length === 1 && /^[a-z_]{1,80}$/.test(error ?? "") && !params.has("code");

if (incoming.hash || !validState || (!validCode && !validError)) {
  status.textContent = "This return link is invalid. Open COROS Core and start sleep authorization again.";
} else {
  const target = new URL("coroscore://oauth/coros-mcp");
  target.searchParams.set("state", state);
  target.searchParams.set(validCode ? "code" : "error", validCode ? code : error);
  link.href = target.href;
  link.hidden = false;
  status.textContent = "Returning to the app. If it does not open automatically, tap the link below.";
  window.location.replace(target.href);
}
