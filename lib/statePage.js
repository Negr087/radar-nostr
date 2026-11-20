// Data for the State of Nostr page (/state): the whole network rather than one app. Live
// numbers for the last 24 h (network_summary), one row per day (network_daily, worked out
// every night), what people do (categories), the busiest apps and the busiest hours.

import { cache } from "react";
import { heatGrid } from "./appPage.js";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { CATEGORIES } from "./kinds.js";
import { storedAppInfo } from "./knownApps.js";
import { rpc, select } from "./supabase.js";

export const DAILY_DAYS = 90;
export const STATE_HEATMAP_DAYS = 28;
const TOP_APPS = 8;
const MIN_COVERAGE = 0.9; // share of buckets stored for a trend to be shown

// % change from `prev` to `cur`, or null when there's nothing to compare with.
export const change = (cur, prev) =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

// category_history rows -> [{cat, label, color, events, share}], biggest first.
export function categoryShares(rows) {
  const totals = new Map();
  for (const r of rows) totals.set(r.category, (totals.get(r.category) || 0) + Number(r.events));
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals]
    .map(([cat, events]) => ({
      cat,
      label: CATEGORIES[cat]?.label || cat,
      color: CATEGORIES[cat]?.color || CATEGORIES.other.color,
      events,
      share: all ? (events / all) * 100 : 0,
    }))
    .sort((a, b) => b.events - a.events);
}

// network_daily rows (any order) -> oldest first, with `t` (start of the day, ms) and
// numbers as numbers. Days the worker didn't run at all are left out. `users` / `users30`
// are null for days whose period started before the web of trust (they'd count everyone).
export function dailyRows(rows) {
  return rows
    .filter((r) => r.coverage > 0)
    .map((r) => ({
      t: Date.parse(`${r.day}T00:00:00Z`),
      day: r.day,
      users: r.users,
      users30: r.users_30d,
      events: Number(r.events),
      zaps: r.zaps,
      sats: Number(r.sats),
      apps: r.apps,
      coverage: r.coverage,
    }))
    .sort((a, b) => a.t - b.t);
}

export const loadState = cache(async () => {
  await refreshBlocklist();
  const optional = (p) => p.catch(() => []);
  const [[summary], daily, categories, top, heat] = await Promise.all([
    optional(rpc("network_summary", {})),
    optional(select("network_daily", `select=*&order=day.desc&limit=${DAILY_DAYS}`)),
    optional(rpc("category_history", { minutes: 10080, step_minutes: 1440 })),
    optional(rpc("top_apps_by_users", { minutes: 1440, max_rows: TOP_APPS * 2 })),
    optional(rpc("activity_heatmap", { key: null, days: STATE_HEATMAP_DAYS })),
  ]);
  const days = dailyRows(daily);
  const last = days[days.length - 1];
  // A month-over-month figure needs a month before it with its own 30-day count.
  const monthAgo = last && days.find((d) => d.t === last.t - 30 * 86400000);
  const recent = days.filter((d) => d.t > last.t - 60 * 86400000);
  const fullMonths =
    monthAgo?.users30 != null && recent.length >= 60 && recent.every((d) => d.coverage >= 0.5);

  const live = summary
    ? {
        users: Number(summary.users_day),
        usersWeek: Number(summary.users_week),
        events: Number(summary.events_day),
        zaps: Number(summary.zaps_day),
        sats: Number(summary.sats_day),
        apps: Number(summary.apps_day),
        // Trends only when both 24 h periods were stored almost entirely.
        trends:
          summary.coverage_day >= MIN_COVERAGE && summary.coverage_prev >= MIN_COVERAGE
            ? {
                users: change(Number(summary.users_day), Number(summary.users_prev)),
                events: change(Number(summary.events_day), Number(summary.events_prev)),
                sats: change(Number(summary.sats_day), Number(summary.sats_prev)),
              }
            : null,
      }
    : null;

  return {
    live,
    days,
    // Users over the 30 days up to yesterday, once there's a month of trusted history.
    month:
      last?.users30 != null
        ? {
            users: last.users30,
            change: fullMonths ? change(last.users30, monthAgo.users30) : null,
          }
        : null,
    gaps: days.filter((d) => d.coverage < MIN_COVERAGE),
    categories: categoryShares(categories),
    top: top
      .filter((r) => !isBlockedAppKey(r.app_key))
      .slice(0, TOP_APPS)
      .map((r) => ({
        key: r.app_key,
        slug: r.app_key.startsWith("app:") ? r.app_key.slice(4) : null,
        ...storedAppInfo(r.app_key, r),
        users: Number(r.users),
      })),
    heat: heat.length ? heatGrid(heat) : null,
  };
});
