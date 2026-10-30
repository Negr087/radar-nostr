// Blocked clients stored in the database (blocked_clients table), on top of the built-in
// lists in lib/bots.js. Shared by the page and the worker; both refresh it every 10 min.

import { setExtraBlocks } from "./bots.js";
import { rpc } from "./supabase.js";

const REFRESH_MS = 10 * 60 * 1000;

let loadedAt = 0;
let loading = null;

// Loads the blocklist if it's older than REFRESH_MS (or `force`) and resolves to how many
// entries it has (undefined if it didn't reload). Never throws: if the database can't be
// reached it resolves to null, the previous list stays and the next call tries again.
export function refreshBlocklist({ force = false } = {}) {
  if (loading) return loading;
  if (!force && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve();
  loading = rpc("blocklist", {})
    .then((rows) => {
      setExtraBlocks(rows);
      loadedAt = Date.now();
      return rows.length;
    })
    .catch(() => null)
    .finally(() => {
      loading = null;
    });
  return loading;
}
