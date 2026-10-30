// Rankings read from the database: the page's ranking (lib/useHistory.js) and the public
// API (app/api/) share this. No React, so it runs on the server too.

import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { rpc } from "./supabase.js";

export const RANKING_WINDOWS = { hour: 60, day: 1440, week: 10080 }; // minutes

// metric -> [database function, trend metric (null: no trend)]
export const RANKING_METRICS = {
  events: ["top_apps", "events"],
  sats: ["top_zapped_apps", "sats"],
  users: ["top_apps_by_users", null],
  new: ["new_apps", null],
};

// Smallest previous-period count a trend is shown for: below it, percentages are noise.
const TREND_MIN = { events: 10, sats: 1000 };

// Change vs. the previous period, in % (null when there's too little to compare, or the
// worker wasn't covering both periods).
function trendOf(row, metric) {
  if (!row || row.previous == null) return null;
  const recent = Number(row.recent);
  const previous = Number(row.previous);
  if (previous < TREND_MIN[metric]) return null;
  return Math.round((recent / previous - 1) * 100);
}

// Top `size` apps by `metric` over the last `minutes`, blocked apps left out:
// [{key, count, zaps?, firstSeen?, trend, name, website, icon}], with the display info the
// worker stored (callers can prefer better info they have).
export async function fetchRanking(metric, minutes, size) {
  const [fn, trendMetric] = RANKING_METRICS[metric];
  await refreshBlocklist();
  // Ask for extra rows: blocked apps are filtered out here.
  const rows = await rpc(fn, { minutes, max_rows: size * 2 });
  const items = rows
    .filter((r) => !isBlockedAppKey(r.app_key))
    .slice(0, size)
    .map((r) => ({
      key: r.app_key,
      count: Number(r.events ?? r.sats ?? r.users),
      zaps: r.zaps == null ? undefined : Number(r.zaps),
      firstSeen: r.first_seen ? new Date(r.first_seen).getTime() : undefined,
      trend: null,
      name: r.name,
      website: r.website,
      icon: r.icon,
    }));
  if (trendMetric && items.length) {
    // Without trends the ranking still works.
    const trends = await rpc("app_trends", {
      minutes,
      keys: items.map((r) => r.key),
      metric: trendMetric,
    }).catch(() => []);
    const byKey = new Map(trends.map((t) => [t.app_key, t]));
    for (const item of items) item.trend = trendOf(byKey.get(item.key), trendMetric);
  }
  return items;
}
