// Data for the comparison page (/compare?a=primal&b=damus), read on the server from the
// stored counts. Builds on each app's page data (lib/appPage.js).

import { cache } from "react";
import { fillPoints, loadAppPage } from "./appPage.js";
import { refreshBlocklist } from "./blocklist.js";
import { isBlockedAppKey } from "./bots.js";
import { normalizeName } from "./knownApps.js";
import { rpc } from "./supabase.js";

const CHOICES = 40; // apps offered in the pickers: the most active ones today

// The most active apps of the last 24 h, for the pickers and the default comparison:
// [{slug, name}]. Cached per request, like the loaders below: the page and its metadata
// share one load.
export const loadChoices = cache(async () => {
  await refreshBlocklist();
  const rows = await rpc("top_apps", { minutes: 1440, max_rows: CHOICES * 2 }).catch(() => []);
  return rows
    .filter((r) => r.app_key.startsWith("app:") && !isBlockedAppKey(r.app_key))
    .slice(0, CHOICES)
    .map((r) => ({ slug: r.app_key.slice(4), name: r.name }));
});

// Which two apps to compare: the ones asked for (normalized), or else today's top apps.
export function pickSlugs(a, b, choices) {
  const first = normalizeName(a) || null;
  const second = normalizeName(b) || null;
  const pick = (taken) => choices.find((c) => !taken.includes(c.slug))?.slug || null;
  const slugA = first || pick([second]);
  const slugB = second || pick([slugA]);
  return [slugA, slugB];
}

// One app's page data plus a point every 6 h over the last 7 days; null if unknown.
export const loadCompared = cache(async (slug) => {
  if (!slug) return null;
  const app = await loadAppPage(slug);
  if (!app) return null;
  const week = await rpc("app_history", { key: app.key, minutes: 10080, step_minutes: 360 }).catch(
    () => []
  );
  return { ...app, weekPoints: fillPoints(week, 360, 28) };
});
