// Small display helpers shared by the feed and the zap stream.

export function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export function short(pk) {
  return pk ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : "anon";
}

// 21 -> "21", 1500 -> "1.5k", 2100000 -> "2.1M"
export function compactSats(n) {
  if (n == null) return "?";
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(n);
}
