// Turns classified records (from lib/engine.js) into the rows add_activity() expects:
// counts per 10 minute bucket, per app, per category, and zaps, plus each app's authors
// (hashed) for unique user counts. Pure: no network.

import { createHash } from "node:crypto";

export const BUCKET_MS = 10 * 60 * 1000;

// Turns a pubkey into a 64-bit number (as a string: JSON numbers lose precision past 2^53)
// keyed by `salt`, so the stored ids can't be matched back to accounts. The salt has to stay
// the same: with a new one, everyone counts again as a new user in the windows it spans.
export function authorHasher(salt) {
  if (!salt) throw new Error("authorHasher needs a salt");
  return (pubkey) =>
    createHash("sha256").update(salt).update(pubkey).digest().readBigInt64BE(0).toString();
}

export function bucketOf(t) {
  return new Date(Math.floor(t / BUCKET_MS) * BUCKET_MS).toISOString();
}

// `lookupApp(key)` gives the display info for app_info (name, website, pictures).
// `hashAuthor` (from authorHasher): without it, no author rows.
// `isTrusted(pubkey)` (worker/wot.js): marks each author row as followed by the network
// or not; null (or no function) leaves `trusted` out, and the database takes it as trusted.
export function buildRows(records, lookupApp, hashAuthor, isTrusted) {
  const apps = new Map(); // "bucket|key" -> events
  const zaps = new Map(); // "bucket|key" -> {zaps, sats}
  const categories = new Map(); // "bucket|cat" -> events
  const authors = new Map(); // "bucket|key|hash" -> row
  const platforms = new Map(); // "bucket|key|platform" -> events
  const seenApps = new Set();

  for (const r of records) {
    const bucket = bucketOf(r.t);
    const cat = `${bucket}|${r.cat}`;
    categories.set(cat, (categories.get(cat) || 0) + 1);
    if (r.appKey) {
      const k = `${bucket}|${r.appKey}`;
      apps.set(k, (apps.get(k) || 0) + 1);
      seenApps.add(r.appKey);
      if (r.platform) {
        const p = `${k}|${r.platform}`;
        platforms.set(p, (platforms.get(p) || 0) + 1);
      }
      if (hashAuthor && r.actor) {
        const author = hashAuthor(r.actor);
        const row = { bucket, app_key: r.appKey, author };
        const trusted = isTrusted ? isTrusted(r.actor) : null;
        if (trusted != null) row.trusted = trusted;
        authors.set(`${k}|${author}`, row);
      }
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
    authors: [...authors.values()],
    platforms: [...platforms].map(([k, events]) => {
      const [bucket, rest] = split(k);
      const i = rest.lastIndexOf("|");
      return { bucket, app_key: rest.slice(0, i), platform: rest.slice(i + 1), events };
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
    // A set, not a sum: the same author twice in a bucket is one author.
    authors: sumBy(
      [...(base.authors || []), ...(extra.authors || [])],
      (r) => `${r.bucket}|${r.app_key}|${r.author}`,
      []
    ),
    platforms: sumBy(
      [...(base.platforms || []), ...(extra.platforms || [])],
      (r) => `${r.bucket}|${r.app_key}|${r.platform}`,
      ["events"]
    ),
    app_info: [...latest.values()],
  };
}

export const isEmpty = (rows) =>
  !rows.apps.length &&
  !rows.zaps.length &&
  !rows.categories.length &&
  !rows.authors.length &&
  !(rows.platforms || []).length &&
  !rows.app_info.length;
