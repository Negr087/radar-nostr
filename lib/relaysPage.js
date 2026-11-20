// Data for the relays page (/relays), read on the server from the stored counts: how much
// of the counted traffic each relay carries, how often it's the first or the only one to
// deliver an event, how far behind the fastest one it usually is, and which apps reach it.

import { cache } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { storedAppInfo } from "./knownApps.js";
import { rpc } from "./supabase.js";

export const RELAY_WINDOW_MINUTES = 1440;
const MATRIX_APPS = 12;
// The worker writes the relay status every minute; older than this, it isn't current.
const STATUS_STALE_SECONDS = 10 * 60;

const pct = (n, total) => (total > 0 ? (n / total) * 100 : 0);
export const hostOf = (url) => url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");

// relay_stats rows -> [{relay, host, events, share, fastest, solo, lagMs, status}], busiest
// first. share / fastest / solo: % of every counted event. lagMs: average delay of the
// copies it delivered after another relay, null when it never was late. status: "up",
// "down" or null when the worker hasn't said lately.
export function relayRows(rows) {
  return rows
    .map((r) => {
      const total = Number(r.total);
      const events = Number(r.events);
      const late = events - Number(r.fastest);
      const current = r.status_age_seconds != null && r.status_age_seconds < STATUS_STALE_SECONDS;
      return {
        relay: r.relay,
        host: hostOf(r.relay),
        events,
        share: pct(events, total),
        fastest: pct(Number(r.fastest), total),
        solo: pct(Number(r.solo), total),
        lagMs: late > 0 ? Number(r.lag_ms) / late : null,
        status: current ? (r.connected ? "up" : "down") : null,
        since: r.since,
      };
    })
    .sort((a, b) => b.events - a.events);
}

// relay_app_matrix rows -> {apps: [{key, slug, name, pictures, total}], cells: Map("relay|key"
// -> % of the app's events that relay delivered)}, apps busiest first.
export function relayMatrix(rows) {
  const apps = new Map();
  const cells = new Map();
  for (const r of rows) {
    if (isBlockedAppKey(r.app_key)) continue;
    if (!apps.has(r.app_key)) {
      apps.set(r.app_key, {
        key: r.app_key,
        slug: r.app_key.startsWith("app:") ? r.app_key.slice(4) : null,
        ...storedAppInfo(r.app_key, r),
        total: Number(r.app_total),
      });
    }
    cells.set(`${r.relay}|${r.app_key}`, Math.min(100, pct(Number(r.events), Number(r.app_total))));
  }
  return { apps: [...apps.values()].sort((a, b) => b.total - a.total), cells };
}

export const loadRelays = cache(async () => {
  await refreshBlocklist();
  const [stats, matrix] = await Promise.all([
    rpc("relay_stats", { minutes: RELAY_WINDOW_MINUTES }).catch(() => []),
    rpc("relay_app_matrix", { minutes: RELAY_WINDOW_MINUTES, max_apps: MATRIX_APPS * 2 }).catch(
      () => []
    ),
  ]);
  const relays = relayRows(stats);
  const total = stats.length ? Number(stats[0].total) : 0;
  const m = relayMatrix(matrix);
  return {
    relays,
    total,
    connected: relays.filter((r) => r.status === "up").length,
    apps: m.apps.slice(0, MATRIX_APPS),
    cells: m.cells,
  };
});
