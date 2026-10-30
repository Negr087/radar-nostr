// Data for an app's own page (/app/<name>) and its share image, read on the server from
// the stored counts. `name` is the normalized app name, the part after "app:" in its key.

import { cache } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { normalizeName, storedAppInfo } from "./knownApps.js";
import { rpc } from "./supabase.js";

const RANK_DEPTH = 50; // positions looked at for "#N today"

// Null when the app is unknown to the database or blocked. Cached per request, so the
// page and its metadata share one load.
export const loadAppPage = cache(async (name) => {
  const slug = normalizeName(decodeURIComponent(name));
  if (!slug) return null;
  const key = `app:${slug}`;
  await refreshBlocklist();
  if (isBlockedAppKey(key)) return null;

  const [[summary], [users], top, history] = await Promise.all([
    rpc("app_summary", { key }),
    // Without user counts the page still works.
    rpc("app_users", { key }).catch(() => []),
    rpc("top_apps", { minutes: 1440, max_rows: RANK_DEPTH }),
    rpc("app_history", { key, minutes: 1440, step_minutes: 60 }),
  ]);
  if (!summary) return null;

  const info = storedAppInfo(key, summary);
  const rank = top.filter((r) => !isBlockedAppKey(r.app_key)).findIndex((r) => r.app_key === key);

  // One point per hour for the last 24 h, zero where nothing was counted.
  const byHour = new Map(history.map((r) => [new Date(r.bucket).getTime(), Number(r.events)]));
  const thisHour = Math.floor(Date.now() / 3600000) * 3600000;
  const points = [];
  for (let i = 23; i >= 0; i--) {
    const t = thisHour - i * 3600000;
    points.push({ t, events: byHour.get(t) || 0 });
  }

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
  };
});
