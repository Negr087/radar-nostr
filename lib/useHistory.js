"use client";

import { useEffect, useState } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { rpc } from "./supabase.js";

const REFRESH_MS = 60 * 1000; // the worker writes once a minute
const RANKING_WINDOWS = { hour: 60, day: 1440, week: 10080 }; // minutes
const RANKING_SIZE = 10;

// Display info for a stored app: what the page knows (verified icon, listing) first, then
// what the worker stored (for apps this browser hasn't seen yet).
function withInfo(row, getApp) {
  const local = getApp(row.app_key);
  const known = local && local.name !== "Unnamed app";
  return {
    key: row.app_key,
    count: Number(row.events ?? row.sats),
    zaps: row.zaps == null ? undefined : Number(row.zaps),
    firstSeen: row.first_seen ? new Date(row.first_seen).getTime() : undefined,
    name: known ? local.name : row.name,
    website: local?.website || row.website,
    pictures: [...(local?.pictures || []), row.icon].filter(Boolean),
  };
}

// Runs `load` now and every REFRESH_MS while `deps` don't change. `load(alive)`: check
// `alive()` before setting state, the component may be gone by the time the data arrives.
function usePolling(load, deps) {
  useEffect(() => {
    let alive = true;
    const isAlive = () => alive;
    load(isAlive);
    const timer = setInterval(() => load(isAlive), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, deps);
}

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

// Top apps for each window, from one of the ranking functions in supabase/schema.sql.
// With `trendMetric`, each row also gets its trend vs. the previous period.
async function loadRanking(fn, getApp, trendMetric) {
  const entries = await Promise.all(
    Object.entries(RANKING_WINDOWS).map(async ([id, minutes]) => {
      // Ask for extra rows: blocked apps are filtered out here.
      const rows = await rpc(fn, { minutes, max_rows: RANKING_SIZE * 2 });
      const clean = rows.filter((r) => !isBlockedAppKey(r.app_key)).slice(0, RANKING_SIZE);
      const items = clean.map((r) => withInfo(r, getApp));
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
      return [id, items];
    })
  );
  return Object.fromEntries(entries);
}

// Rankings for the last hour / day / week, from the database (same for every visitor):
// by events (`events.hour`…), by zapped sats (`sats.hour`…) and apps first seen in the
// period (`new.hour`…).
const METRIC_FUNCTIONS = {
  events: ["top_apps", "events"],
  sats: ["top_zapped_apps", "sats"],
  new: ["new_apps", null],
};

export function useRanking(getApp) {
  const empty = { hour: [], day: [], week: [] };
  const [ranking, setRanking] = useState({
    events: empty,
    sats: empty,
    new: empty,
    loaded: false,
    error: {},
  });

  usePolling(
    async (alive) => {
      // Up-to-date blocks first, so newly blocked apps drop out of the stored rankings.
      await refreshBlocklist();
      // Each metric on its own: one failing (e.g. its function missing) keeps the others.
      const metrics = Object.keys(METRIC_FUNCTIONS);
      const results = await Promise.allSettled(
        metrics.map((m) => {
          const [fn, trendMetric] = METRIC_FUNCTIONS[m];
          return loadRanking(fn, getApp, trendMetric);
        })
      );
      if (!alive()) return;
      setRanking((prev) => {
        const next = { loaded: true, error: {} };
        metrics.forEach((m, i) => {
          next[m] = results[i].value || prev[m];
          next.error[m] = results[i].status === "rejected";
        });
        return next;
      });
    },
    [getApp]
  );

  return ranking;
}

// Pulse history: events per category for the last 24 h (hourly) or 7 days (every 6 h),
// in the same shape as the live pulse ([{minute, total, byCat}], `minute` = column start).
export const PULSE_WINDOWS = {
  day: { minutes: 1440, step: 60 },
  week: { minutes: 10080, step: 360 },
};

export function useCategoryHistory(windowId) {
  const [columns, setColumns] = useState(null);

  useEffect(() => setColumns(null), [windowId]);
  usePolling(
    async (alive) => {
      const w = PULSE_WINDOWS[windowId];
      if (!w) return;
      try {
        const rows = await rpc("category_history", { minutes: w.minutes, step_minutes: w.step });
        const stepMs = w.step * 60000;
        const last = Math.floor(Date.now() / stepMs) * stepMs;
        const count = w.minutes / w.step;
        const byTime = new Map();
        for (let i = count - 1; i >= 0; i--) {
          byTime.set(last - i * stepMs, { minute: last - i * stepMs, total: 0, byCat: {} });
        }
        for (const r of rows) {
          const col = byTime.get(new Date(r.bucket).getTime());
          if (!col) continue;
          const n = Number(r.events);
          col.byCat[r.category] = (col.byCat[r.category] || 0) + n;
          col.total += n;
        }
        if (alive()) setColumns([...byTime.values()]);
      } catch {
        if (alive()) setColumns({ error: true });
      }
    },
    [windowId]
  );

  return columns;
}

// How fresh the stored counts are, from the worker's heartbeat (null until loaded).
// `stale`: no heartbeat for STALE_S, so the worker is down or can't reach the database.
const STALE_S = 5 * 60;

export function useWorkerStatus() {
  const [status, setStatus] = useState(null);

  usePolling(async (alive) => {
    try {
      const [row] = await rpc("radar_status", {});
      if (!alive()) return;
      setStatus(
        row
          ? {
              updatedAt: new Date(row.updated_at).getTime(),
              age: row.age_seconds,
              stale: row.age_seconds > STALE_S,
              relays: row.relays,
              relaysTotal: row.relays_total,
            }
          : { error: true }
      );
    } catch {
      if (alive()) setStatus({ error: true });
    }
  }, []);

  return status;
}

// One app's stored activity: totals for the last hour / day / week and hourly points
// for the last 24 h.
export function useAppHistory(key) {
  const [history, setHistory] = useState(null);

  useEffect(() => setHistory(null), [key]);
  usePolling(
    async (alive) => {
      if (!key) return;
      try {
        const [lastHour, week] = await Promise.all([
          rpc("app_history", { key, minutes: 60, step_minutes: 10 }),
          rpc("app_history", { key, minutes: 10080, step_minutes: 60 }),
        ]);
        const now = Date.now();
        const sum = (rows) => rows.reduce((n, r) => n + Number(r.events), 0);
        const byHour = new Map(week.map((r) => [new Date(r.bucket).getTime(), Number(r.events)]));
        const thisHour = Math.floor(now / 3600000) * 3600000;
        const points = [];
        for (let i = 23; i >= 0; i--) {
          const t = thisHour - i * 3600000;
          points.push({ t, events: byHour.get(t) || 0 });
        }
        if (!alive()) return;
        setHistory({
          hour: sum(lastHour),
          day: sum(week.filter((r) => now - new Date(r.bucket).getTime() < 24 * 3600000)),
          week: sum(week),
          points,
        });
      } catch {
        if (alive()) setHistory({ error: true });
      }
    },
    [key]
  );

  return history;
}
