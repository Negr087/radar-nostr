// Turns classified records (from lib/engine.js) into the rows add_activity() expects:
// counts per 10 minute bucket, per app, per category, and zaps. Pure: no network.

export const BUCKET_MS = 10 * 60 * 1000;

export function bucketOf(t) {
  return new Date(Math.floor(t / BUCKET_MS) * BUCKET_MS).toISOString();
}

// `lookupApp(key)` gives the display info for app_info (name, website, pictures).
export function buildRows(records, lookupApp) {
  const apps = new Map(); // "bucket|key" -> events
  const zaps = new Map(); // "bucket|key" -> {zaps, sats}
  const categories = new Map(); // "bucket|cat" -> events
  const seenApps = new Set();

  for (const r of records) {
    const bucket = bucketOf(r.t);
    const cat = `${bucket}|${r.cat}`;
    categories.set(cat, (categories.get(cat) || 0) + 1);
    if (r.appKey) {
      const k = `${bucket}|${r.appKey}`;
      apps.set(k, (apps.get(k) || 0) + 1);
      seenApps.add(r.appKey);
    }
    if (r.zap) {
      const k = `${bucket}|${r.appKey || ""}`;
      const z = zaps.get(k) || { zaps: 0, sats: 0 };
      z.zaps++;
      z.sats += r.zap.sats || 0;
      zaps.set(k, z);
    }
  }

  const split = (k) => {
    const i = k.indexOf("|");
    return [k.slice(0, i), k.slice(i + 1)];
  };
  return {
    apps: [...apps].map(([k, events]) => {
      const [bucket, app_key] = split(k);
      return { bucket, app_key, events };
    }),
    zaps: [...zaps].map(([k, z]) => {
      const [bucket, app_key] = split(k);
      return { bucket, app_key, ...z };
    }),
    categories: [...categories].map(([k, events]) => {
      const [bucket, category] = split(k);
      return { bucket, category, events };
    }),
    app_info: [...seenApps].map((app_key) => {
      const info = lookupApp(app_key);
      return {
        app_key,
        name: info.name,
        website: info.website || null,
        icon: info.pictures[0] || null,
      };
    }),
  };
}

// Adds `extra` rows into `base` (for retrying a flush that failed).
export function mergeRows(base, extra) {
  const sumBy = (list, keyOf, fields) => {
    const map = new Map();
    for (const row of list) {
      const k = keyOf(row);
      const prev = map.get(k);
      if (!prev) map.set(k, { ...row });
      else for (const f of fields) prev[f] += row[f];
    }
    return [...map.values()];
  };
  const latest = new Map([...base.app_info, ...extra.app_info].map((a) => [a.app_key, a]));
  return {
    apps: sumBy([...base.apps, ...extra.apps], (r) => `${r.bucket}|${r.app_key}`, ["events"]),
    zaps: sumBy([...base.zaps, ...extra.zaps], (r) => `${r.bucket}|${r.app_key}`, ["zaps", "sats"]),
    categories: sumBy(
      [...base.categories, ...extra.categories],
      (r) => `${r.bucket}|${r.category}`,
      ["events"]
    ),
    app_info: [...latest.values()],
  };
}

export const isEmpty = (rows) =>
  !rows.apps.length && !rows.zaps.length && !rows.categories.length && !rows.app_info.length;
