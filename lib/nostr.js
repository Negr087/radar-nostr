// Pure parsing helpers for Nostr events (no network, no React).

export function safeJson(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

// Amount in sats of a Lightning invoice, read from the prefix: "lnbc210n1..." = 21 sats.
const BOLT11_UNIT = { "": 1e8, m: 1e5, u: 1e2, n: 1e-1, p: 1e-4 };
export function bolt11Sats(invoice) {
  const m = /^ln(?:bc|tb|bcrt|tbs)(\d+)([munp]?)1/i.exec(invoice || "");
  return m ? Math.round(Number(m[1]) * BOLT11_UNIT[m[2].toLowerCase()]) : null;
}

// Turns a kind 31990 event (app listing, NIP-89) into a plain object.
export function parseHandler(ev, fallbackName) {
  const meta = safeJson(ev?.content);
  const webTag = ev?.tags?.find((t) => t[0] === "web");
  const kinds = (ev?.tags || []).filter((t) => t[0] === "k").map((t) => Number(t[1]));
  return {
    name: meta.display_name || meta.name || fallbackName || null,
    picture: meta.picture || meta.image || null,
    about: meta.about || "",
    website: meta.website || (webTag ? webTag[1].split("<bech32>")[0] : null),
    kinds,
    pubkey: ev?.pubkey || null,
  };
}

// A DVM is an automated service: its listing only declares kinds 5000-6999.
export function isDvmHandler(info) {
  return info.kinds.length > 0 && info.kinds.every((k) => k >= 5000 && k <= 6999);
}
