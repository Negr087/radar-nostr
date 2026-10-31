// On-screen diagnostics for browsers without devtools (smart TVs): open the site with
// ?debug. Plain ES5 inlined in <head>, so it runs even when the app's JS fails to load.
// Shows the browser, missing features, JS errors and a raw WebSocket test to a relay.

export const DEBUG_OVERLAY = `(function () {
  if (!/[?&]debug/.test(location.search)) return;
  var lines = [], errors = [], ws = "connecting...";
  var box;
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function render() {
    if (!box && document.body) {
      box = document.createElement("pre");
      box.style.cssText = "position:fixed;top:0;left:0;right:0;max-height:60vh;overflow:auto;z-index:99999;margin:0;padding:12px;background:#000;color:#0f0;font:16px/1.4 monospace;white-space:pre-wrap;word-break:break-all";
      document.body.appendChild(box);
    }
    if (box) box.innerHTML = esc(lines.concat(["WebSocket relay.damus.io: " + ws, "Errors (" + errors.length + "):"], errors).join("\\n"));
  }
  lines.push("UA: " + navigator.userAgent);
  var missing = [];
  var features = {
    BigInt: "BigInt", globalThis: "globalThis", WebSocket: "WebSocket", TextEncoder: "TextEncoder",
    "crypto.getRandomValues": "crypto.getRandomValues", "crypto.subtle": "crypto.subtle",
    "Promise.allSettled": "Promise.allSettled", queueMicrotask: "queueMicrotask",
    AbortController: "AbortController", ResizeObserver: "ResizeObserver",
    "Symbol.asyncIterator": "Symbol.asyncIterator", "String.prototype.matchAll": "String.prototype.matchAll"
  };
  for (var name in features) {
    try { if (eval("typeof " + features[name]) === "undefined") missing.push(name); } catch (e) { missing.push(name); }
  }
  var syntax = { "?.": "var a; a?.b", "??": "var a; a ?? 1", "class fields": "(class { x = 1 })", "BigInt literal": "0n", "async generators": "(async function* () {})" };
  for (var s in syntax) {
    try { new Function(syntax[s]); } catch (e) { missing.push("syntax " + s); }
  }
  lines.push("Missing: " + (missing.length ? missing.join(", ") : "nothing"));
  window.addEventListener("error", function (e) {
    errors.push((e.message || "error") + (e.filename ? " @ " + e.filename.split("/").pop() + ":" + e.lineno + ":" + e.colno : ""));
    render();
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; errors.push("Promise: " + (r && (r.stack || r.message) || r)); render();
  });
  try {
    var sock = new WebSocket("wss://relay.damus.io");
    var got = 0;
    sock.onopen = function () { ws = "open"; sock.send('["REQ","dbg",{"limit":3}]'); render(); };
    sock.onmessage = function () { got++; ws = "open, " + got + " messages"; render(); };
    sock.onerror = function () { ws = "error"; render(); };
    sock.onclose = function (e) { ws += " (closed " + e.code + ")"; render(); };
  } catch (e) { ws = "throws: " + e.message; }
  document.addEventListener("DOMContentLoaded", render);
  setInterval(render, 2000);
})();`;
