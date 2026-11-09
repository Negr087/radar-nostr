// Data for an app's own page (/app/<name>) and its share image, read on the server from
// the stored counts. `name` is the normalized app name, the part after "app:" in its key.

import { cache } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { normalizeName, storedAppInfo } from "./knownApps.js";
import { rpc } from "./supabase.js";

const RANK_DEPTH = 50; // positions looked at for "#N today"
const OVERLAP_ROWS = 6; // apps listed under "Its users also use"
export const HEATMAP_DAYS = 28;
// Below this many users a return rate is mostly noise: it isn't shown.
const RETENTION_MIN = 10;

// Share of `before` that came back, in %, or null when there are too few to say.
const returned = (before, back) =>
  Number(before) >= RETENTION_MIN ? Math.round((Number(back) / Number(before)) * 100) : null;

// activity_heatmap rows -> 7 rows (Sunday first) of 24 hourly counts (UTC).
export function heatGrid(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of rows) grid[r.dow][r.hour] = Number(r.events);
  return grid;
}

// app_platforms rows -> [{platform, events, share}] plus the share of events that didn't
// say (`unstated`, in %). Null when no platform was ever named.
export function platformShares(rows) {
  if (!rows.length) return null;
  const total = Math.max(Number(rows[0].total), rows.reduce((n, r) => n + Number(r.events), 0));
  const list = rows.map((r) => ({
    platform: r.platform,
    events: Number(r.events),
    share: Math.round((Number(r.events) / total) * 100),
  }));
  const named = list.reduce((n, r) => n + r.events, 0);
  return { list, unstated: Math.round(((total - named) / total) * 100) };
}

// app_history rows -> the last `count` points of `stepMinutes` each, oldest first, zero
// where nothing was counted: [{t, events}].
export function fillPoints(rows, stepMinutes, count) {
  const stepMs = stepMinutes * 60000;
  const byTime = new Map(rows.map((r) => [new Date(r.bucket).getTime(), Number(r.events)]));
  const last = Math.floor(Date.now() / stepMs) * stepMs;
  const points = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = last - i * stepMs;
    points.push({ t, events: byTime.get(t) || 0 });
  }
  return points;
}

// Null when the app is unknown to the database or blocked. Cached per request, so the
// page and its metadata share one load.
export const loadAppPage = cache(async (name) => {
  const slug = normalizeName(decodeURIComponent(name));
  if (!slug) return null;
  const key = `app:${slug}`;
  await refreshBlocklist();
  if (isBlockedAppKey(key)) return null;

  // Without the optional parts (users, overlap, retention, heatmap, platforms) the page
  // still works: each one just doesn't show.
  const optional = (fn, args) => rpc(fn, args).catch(() => []);
  const [[summary], [users], top, history, overlap, [retention], heat, platforms] =
    await Promise.all([
      rpc("app_summary", { key }),
      optional("app_users", { key }),
      rpc("top_apps", { minutes: 1440, max_rows: RANK_DEPTH }),
      rpc("app_history", { key, minutes: 1440, step_minutes: 60 }),
      optional("app_overlap", { key, max_rows: OVERLAP_ROWS * 2 }),
      optional("app_retention", { key }),
      optional("activity_heatmap", { key, days: HEATMAP_DAYS }),
      optional("app_platforms", { key }),
    ]);
  if (!summary) return null;

  const info = storedAppInfo(key, summary);
  const rank = top.filter((r) => !isBlockedAppKey(r.app_key)).findIndex((r) => r.app_key === key);

  const points = fillPoints(history, 60, 24);

  return {
    slug,
    key,
    ...info,
    firstSeen: summary.first_seen,
    hour: Number(summary.hour),
    day: Number(summary.day),
    week: Number(summary.week),
    zapsWeek: Number(summary.zaps_week),
    satsWeek: Number(summary.sats_week),
    // Null too while nothing's counted yet: "0 users and 300 events" reads like a bug.
    users:
      users && Number(users.day) > 0
        ? { hour: Number(users.hour), day: Number(users.day), week: Number(users.week) }
        : null,
    rank: rank >= 0 ? rank + 1 : null,
    points,
    // [{key, slug, name, pictures, shared, share}]: share = % of this app's users.
    overlap: overlap
      .filter((r) => !isBlockedAppKey(r.app_key))
      .slice(0, OVERLAP_ROWS)
      .map((r) => {
        const other = storedAppInfo(r.app_key, r);
        return {
          key: r.app_key,
          slug: r.app_key.startsWith("app:") ? r.app_key.slice(4) : null,
          name: other.name,
          pictures: other.pictures,
          shared: Number(r.shared),
          share: Math.round((Number(r.shared) / Number(r.users)) * 100),
        };
      }),
    retention: retention
      ? {
          day: returned(retention.day_before, retention.day_back),
          dayBefore: Number(retention.day_before),
          week: returned(retention.week_before, retention.week_back),
          weekBefore: Number(retention.week_before),
        }
      : null,
    heat: heat.length ? heatGrid(heat) : null,
    platforms: platformShares(platforms),
  };
});
