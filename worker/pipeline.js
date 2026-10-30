// The worker's counting logic, without relays or timers: records wait out the hold, bots
// and blocked apps are dropped, the rest go to the database, and a failed flush is kept
// and retried. Kept apart from worker/index.js so it can be tested.

import { isBlockedAppKey } from "../lib/bots.js";
import { buildRows, isEmpty, mergeRows } from "./aggregate.js";

// `db`: {addActivity, heartbeat} (worker/supabase.js), or null for a dry run.
// `holdMs`: how long records wait before counting (so rate-based bot detection can still
// drop them). `stallMs`: silence after which the connections are taken for dead.
export function createPipeline({ engine, db, hashAuthor, holdMs, stallMs, log = () => {} }) {
  let pending = []; // classified records waiting out holdMs
  let unsent = null; // rows from a failed flush, retried next time
  let lastEventAt = Date.now();
  const totals = { events: 0, counted: 0, droppedBots: 0, flushes: 0, failures: 0 };

  return {
    totals,
    get pending() {
      return pending.length;
    },
    get hasUnsent() {
      return unsent !== null;
    },

    // Every event that arrives, counted or not (the stall check uses it).
    seen(now = Date.now()) {
      totals.events++;
      lastEventAt = now;
    },

    add(record) {
      pending.push(record);
    },

    stalled(now = Date.now()) {
      return now - lastEventAt > stallMs;
    },

    // Sends the records that waited long enough (all of them if `final`). Returns a
    // one-line summary, or null when there was nothing to send.
    async flush({ now = Date.now(), final = false } = {}) {
      engine.checkRates(now);
      const ready = final ? pending : pending.filter((r) => now - r.t >= holdMs);
      pending = final ? [] : pending.filter((r) => now - r.t < holdMs);
      // Also drops apps blocked (in the database) while their records were waiting.
      const clean = ready.filter((r) => !engine.isBotItem(r) && !isBlockedAppKey(r.appKey));
      totals.droppedBots += ready.length - clean.length;
      totals.counted += clean.length;

      let rows = buildRows(clean, engine.lookupApp, hashAuthor);
      if (unsent) rows = mergeRows(unsent, rows);
      if (isEmpty(rows)) return null;

      const summary =
        `${clean.length} events · ${rows.apps.length} app rows · ` +
        `${rows.zaps.reduce((n, z) => n + z.zaps, 0)} zaps · ${rows.authors.length} author rows · ` +
        `pending ${pending.length}`;
      if (!db) {
        log("[dry run]", summary);
        const top = [...rows.apps].sort((a, b) => b.events - a.events).slice(0, 5);
        log("  top:", top.map((a) => `${a.app_key}=${a.events}`).join(" "));
        unsent = null;
        return summary;
      }
      try {
        await db.addActivity(rows);
        unsent = null;
        totals.flushes++;
        log("flushed", summary);
      } catch (err) {
        unsent = rows;
        totals.failures++;
        log("flush failed, will retry:", err.message);
      }
      return summary;
    },

    // Tells the page the stored counts are up to date. Skipped while a flush is waiting to
    // be retried: then the counts aren't up to date, and the page should notice.
    async heartbeat(status) {
      if (!db || unsent) return false;
      try {
        await db.heartbeat(status);
        return true;
      } catch (err) {
        log("heartbeat failed:", err.message);
        return false;
      }
    },
  };
}
