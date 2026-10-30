"use client";

import { useEffect, useState } from "react";
import { refreshBlocklist } from "./blocklist.js";
import { RANKING_METRICS, RANKING_WINDOWS, fetchRanking } from "./ranking.js";
import { rpc } from "./supabase.js";

const REFRESH_MS = 60 * 1000; // the worker writes once a minute
const RANKING_SIZE = 10;

// Display info for a stored app: what the page knows (verified icon, listing) first, then
// what the worker stored (for apps this browser hasn't seen yet).
function withInfo(item, getApp) {
  const local = getApp(item.key);
  const known = local && local.name !== "Unnamed app";
  return {
    ...item,
    name: known ? local.name : item.name,
    website: local?.website || item.website,
    pictures: [...(local?.pictures || []), item.icon].filter(Boolean),
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

// One metric's ranking for each window: {hour: [...], day: [...], week: [...]}.
async function loadRanking(metric, getApp) {
  const entries = await Promise.all(
    Object.entries(RANKING_WINDOWS).map(async ([id, minutes]) => {
      const items = await fetchRanking(metric, minutes, RANKING_SIZE);
      return [id, items.map((item) => withInfo(item, getApp))];
    })
  );
  return Object.fromEntries(entries);
}

// Rankings for the last hour / day / week, from the database (same for every visitor):
// by events (`events.hour`…), by zapped sats (`sats.hour`…), by unique users (`users.hour`…)
// and apps first seen in the period (`new.hour`…).
export function useRanking(getApp) {
  const empty = { hour: [], day: [], week: [] };
  const [ranking, setRanking] = useState({
    events: empty,
    sats: empty,
    users: empty,
    new: empty,
    loaded: false,
    error: {},
  });

  usePolling(
    async (alive) => {
      // Up-to-date blocks first, so newly blocked apps drop out of the stored rankings.
      await refreshBlocklist();
      // Each metric on its own: one failing (e.g. its function missing) keeps the others.
      const metrics = Object.keys(RANKING_METRICS);
      const results = await Promise.allSettled(metrics.map((m) => loadRanking(m, getApp)));
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
