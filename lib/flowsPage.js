// Data for the app flows page (/flows): users who left one app and started using another,
// last 7 days vs. the 7 days before. Worked out in the database every 6 hours
// (refresh_app_flows in supabase/schema.sql); this only reads the result.

import { cache } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { storedAppInfo } from "./knownApps.js";
import { rpc, select } from "./supabase.js";

const FLOW_ROWS = 60;
const APP_ROWS = 20;
// Below this share of buckets stored, a period is missing enough to skew the comparison.
export const MIN_COVERAGE = 0.9;

const appOf = (key, name, icon) => ({
  key,
  slug: key.startsWith("app:") ? key.slice(4) : null,
  ...storedAppInfo(key, { name, icon }),
});

export const loadFlows = cache(async () => {
  await refreshBlocklist();
  const [[status], flows, apps] = await Promise.all([
    select("flows_status", "select=*&id=eq.1").catch(() => []),
    rpc("top_flows", { max_rows: FLOW_ROWS }).catch(() => []),
    rpc("app_flow_summary", { max_rows: APP_ROWS * 2 }).catch(() => []),
  ]);
  if (!status) return null;
  return {
    computedAt: status.computed_at,
    start: status.window_start,
    mid: status.window_mid,
    end: status.window_end,
    before: status.users_before,
    after: status.users_after,
    kept: status.users_kept,
    complete: status.coverage_before >= MIN_COVERAGE && status.coverage_after >= MIN_COVERAGE,
    flows: flows
      .filter((f) => !isBlockedAppKey(f.from_key) && !isBlockedAppKey(f.to_key))
      .map((f) => ({
        from: appOf(f.from_key, f.from_name, f.from_icon),
        to: appOf(f.to_key, f.to_name, f.to_icon),
        users: f.users,
      })),
    apps: apps
      .filter((a) => !isBlockedAppKey(a.app_key))
      .slice(0, APP_ROWS)
      .map((a) => ({
        ...appOf(a.app_key, a.name, a.icon),
        before: a.users_before,
        after: a.users_after,
        kept: a.users_kept,
        gained: a.gained,
        lost: a.lost,
        arrivedNew: a.arrived_new,
        wentQuiet: a.went_quiet,
      })),
  };
});
