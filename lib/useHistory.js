"use client";

import { useEffect, useState } from "react";
import { isBotClient } from "./bots.js";
import { rpc } from "./supabase.js";

const REFRESH_MS = 60 * 1000; // the worker writes once a minute
const RANKING_WINDOWS = { hour: 60, day: 1440, week: 10080 }; // minutes
const RANKING_SIZE = 10;

// An app whose name is blocked now: counts stored before the block shouldn't show up.
const isBlockedKey = (key) => key.startsWith("app:") && isBotClient(key.slice(4));

// Display info for a stored app: what the page knows (verified icon, listing) first, then
// what the worker stored (for apps this browser hasn't seen yet).
function withInfo(row, getApp) {
  const local = getApp(row.app_key);
  const known = local && local.name !== "Unnamed app";
  return {
    key: row.app_key,
    count: Number(row.events),
    name: known ? local.name : row.name,
    website: local?.website || row.website,
    pictures: [...(local?.pictures || []), row.icon].filter(Boolean),
  };
}

// Ranking for the last hour / day / week, from the database (same for every visitor).
export function useRanking(getApp) {
  const [ranking, setRanking] = useState({ hour: [], day: [], week: [], loaded: false });

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const entries = await Promise.all(
          Object.entries(RANKING_WINDOWS).map(async ([id, minutes]) => {
            // Ask for extra rows: blocked apps are filtered out here.
            const rows = await rpc("top_apps", { minutes, max_rows: RANKING_SIZE * 2 });
            const clean = rows.filter((r) => !isBlockedKey(r.app_key)).slice(0, RANKING_SIZE);
            return [id, clean.map((r) => withInfo(r, getApp))];
          })
        );
        if (alive) setRanking({ ...Object.fromEntries(entries), loaded: true });
      } catch {
        if (alive) setRanking((prev) => ({ ...prev, loaded: true, error: true }));
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [getApp]);

  return ranking;
}

// One app's stored activity: totals for the last hour / day / week and hourly points
// for the last 24 h.
export function useAppHistory(key) {
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    setHistory(null);
    async function load() {
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
        if (!alive) return;
        setHistory({
          hour: sum(lastHour),
          day: sum(week.filter((r) => now - new Date(r.bucket).getTime() < 24 * 3600000)),
          week: sum(week),
          points,
        });
      } catch {
        if (alive) setHistory({ error: true });
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key]);

  return history;
}
