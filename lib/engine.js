// The radar's core, shared by the web page and the worker: decides which app an event
// belongs to, whether it comes from a bot, and what a zap is worth. No React, no database:
// callers decide what to do with each classified record (draw it, count it, store it).

import { isBotClient, isBotProfile, rateLimitFor } from "./bots.js";
import { describeKind } from "./kinds.js";
import { KNOWN_APPS, appKeyFor, faviconsFor, normalizeName, safeUrl } from "./knownApps.js";
import { bolt11Sats, isDvmHandler, parseHandler, safeJson } from "./nostr.js";

const SEEN_MAX = 20000; // ids remembered to drop duplicates across relays
const HEX64 = /^[0-9a-f]{64}$/;
export const RATE_WINDOW_MS = 5 * 60 * 1000; // window for rate-based bot detection

// `fetchListing(filter)` (optional) returns a kind 31990 event for a client tag that carries
// a 31990 address; without it those addresses just aren't resolved.
export function createEngine({ fetchListing } = {}) {
  const seen = new Set();
  const appInfo = new Map(); // key -> info
  const handlersByName = new Map(); // normalized name -> 31990 listing
  const appByPubkey = new Map(); // app pubkey -> key (to attribute zaps)
  const fetched = new Set(); // keys whose listing was already requested
  const knownHandlers = new Set(); // "pubkey:d" of 31990 listings already seen
  const bots = new Set(); // pubkeys detected as bots
  let recent = []; // [{actor, t, limit}] events in the window, to measure each account's rate
  const counters = { tagged: 0, newApps: 0, botEvents: 0 };

  // Stores the listing by normalized name, preferring one that has a logo.
  function indexHandler(info) {
    const n = normalizeName(info.name);
    if (!n) return;
    const prev = handlersByName.get(n);
    if (!prev || (!prev.picture && info.picture)) handlersByName.set(n, info);
  }

  // Registers a 31990 listing. Returns the app key, or null if it has no name
  // (some systems publish hundreds of automated nameless listings).
  function registerHandler(ev) {
    const info = parseHandler(ev);
    const key = appKeyFor(info.name);
    if (!key) return null;
    indexHandler(info);
    // Zaps to a DVM are payments for jobs, not support for an app.
    if (!isDvmHandler(info)) appByPubkey.set(ev.pubkey, key);
    return key;
  }

  // A listing fetched up front (not part of the live stream).
  function addListing(ev) {
    const d = ev.tags.find((t) => t[0] === "d")?.[1] || "";
    knownHandlers.add(`${ev.pubkey}:${d}`);
    registerHandler(ev);
  }

  // Final info for an app, combining (in order): known apps map (verified icon),
  // its own 31990 listing, any preloaded listing with the same name, and the website favicon.
  // `pictures` is a list of candidates: Avatar tries them one after another.
  function lookupApp(key) {
    if (!key) return null;
    const norm = key.startsWith("app:") ? key.slice(4) : null;
    const own = appInfo.get(key) || {};
    const known = norm ? KNOWN_APPS[norm] : null;
    const byName = norm ? handlersByName.get(norm) : null;
    const website = safeUrl(known?.website) || safeUrl(own.website) || safeUrl(byName?.website);
    return {
      name: known?.name || own.name || byName?.name || "Unnamed app",
      website,
      pictures: [
        safeUrl(known?.icon),
        safeUrl(own.picture),
        safeUrl(byName?.picture),
        ...faviconsFor(website),
      ].filter(Boolean),
    };
  }

  // A name for an app seen before (e.g. saved in a ranking), unless we already know one.
  function rememberName(key, name) {
    if (!appInfo.has(key)) appInfo.set(key, { name });
  }

  // If the client tag carries a 31990 address, fetch that listing (once per app).
  function resolveApp(key, address) {
    if (!fetchListing || typeof address !== "string" || fetched.has(key)) return;
    const [kind, pk, d] = address.split(":");
    // Some apps send malformed addresses. NDK rejects those filters, but its fetchEvent
    // leaves a timer behind that crashes the process 10 s later, so never pass them on.
    if (kind !== "31990" || !HEX64.test(pk || "") || d === undefined) return;
    fetched.add(key);
    fetchListing({ kinds: [31990], authors: [pk], "#d": [d] })
      .then((h) => {
        if (!h) return;
        const info = parseHandler(h);
        appInfo.set(key, {
          ...appInfo.get(key),
          ...(info.name && { name: info.name }),
          picture: info.picture,
          website: info.website,
        });
        appByPubkey.set(h.pubkey, key);
      })
      .catch(() => {});
  }

  // Classifies one event. Returns null when it should be ignored (duplicate, bot,
  // self-zap); otherwise a record. `now` is the time to file it under; `viaClient` is the
  // app to attribute it to when it has no client tag of its own.
  function classify(ev, { now = Date.now(), viaClient } = {}) {
    if (seen.has(ev.id)) return null;
    seen.add(ev.id);
    // Sets keep insertion order: drop the oldest, not all of them.
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);

    const desc = { ...describeKind(ev.kind) };
    let appKey = null;
    let appName = null;

    // In a zap, the receipt is signed by the LNURL server: the app that sent it
    // is in the zap request (description tag), not in the receipt.
    const zapReq =
      ev.kind === 9735 ? safeJson(ev.tags.find((t) => t[0] === "description")?.[1]) : null;
    const tags = zapReq ? (Array.isArray(zapReq.tags) ? zapReq.tags : []) : ev.tags;

    // Layer 1: client tag (NIP-89)
    const client =
      tags.find((t) => t[0] === "client" && t[1]) || (viaClient ? ["client", viaClient] : null);
    if (client && isBotClient(client[1])) {
      counters.botEvents++;
      return null;
    }
    if (client) {
      appName = client[1];
      appKey = appKeyFor(client[1]) || client[2] || `name:${client[1].toLowerCase()}`;
      if (!appInfo.has(appKey)) appInfo.set(appKey, { name: client[1] });
      resolveApp(appKey, client[2]);
      counters.tagged++;
    }

    // Layer 3: ecosystem
    if (ev.kind === 31990) {
      // Only a "new app" the first time: DVMs republish their listing every few minutes.
      const d = ev.tags.find((t) => t[0] === "d")?.[1] || "";
      const address = `${ev.pubkey}:${d}`;
      const isNew = !knownHandlers.has(address);
      knownHandlers.add(address);
      const key = registerHandler(ev);
      if (!key || !isNew) desc.quiet = true;
      else {
        appKey = key;
        appName = lookupApp(key).name;
        counters.newApps++;
      }
    }

    let actor = ev.pubkey;
    let zapTo = false;
    let zap = null; // every zap goes to the zap stream, with or without an app
    if (ev.kind === 9735) {
      const recipient = ev.tags.find((t) => t[0] === "p")?.[1];
      if (zapReq.pubkey) actor = zapReq.pubkey;
      // The real amount is in the invoice; the request's amount tag is optional.
      const amount = tags.find((t) => t[0] === "amount")?.[1];
      const sats =
        bolt11Sats(ev.tags.find((t) => t[0] === "bolt11")?.[1]) ??
        (amount ? Math.round(Number(amount) / 1000) : null);
      const satsTxt = sats ? ` ${sats.toLocaleString("en-US")} sats` : "";
      zap = {
        recipient,
        sats,
        comment: typeof zapReq.content === "string" ? zapReq.content.slice(0, 140) : "",
        noteId: tags.find((t) => t[0] === "e")?.[1] || null,
      };
      if (recipient && appByPubkey.has(recipient)) {
        // Zap to an app: counts for the app receiving it.
        zapTo = true;
        appKey = appByPubkey.get(recipient);
        appName = lookupApp(appKey).name;
        desc.verb = `zapped${satsTxt} to`;
      } else if (appKey) {
        // Zap to a person sent from an app that signs: counts for that app.
        desc.verb = sats ? `zapped${satsTxt}` : "sent a zap";
      }
      // A zap with no app still counts as a zap, but not for any app.
    }

    // A DVM response (6xxx) is addressed to whoever asked (p tag): replies to a bot are noise too.
    const requester =
      ev.kind >= 6000 && ev.kind <= 6999 ? ev.tags.find((t) => t[0] === "p")?.[1] : null;
    if (bots.has(actor) || (requester && bots.has(requester))) {
      counters.botEvents++;
      return null;
    }
    const limit = rateLimitFor(ev.kind);
    if (limit) recent.push({ actor, t: now, limit });

    // Self-zaps say nothing about anyone (seen from automated boost accounts).
    if (zap && zap.recipient === actor) return null;

    return {
      id: ev.id,
      kind: ev.kind,
      actor,
      requester,
      appKey,
      appName,
      cat: desc.cat,
      verb: desc.verb,
      hint: !appKey ? desc.hint : null,
      zapTo,
      zap,
      preview: ev.kind === 1 || ev.kind === 1111 ? ev.content.slice(0, 140) : null,
      t: now,
      // The feed gets everything with an identified app + anything that isn't a generic
      // note/repost/comment/zap (zaps with no app would just be zaplife again).
      showInFeed: !desc.quiet && Boolean(appKey || ![1, 6, 1111, 9735].includes(ev.kind)),
    };
  }

  // Rate: anyone above the limit for an event type in the window gets flagged as a bot.
  // Returns true if someone new was flagged.
  function checkRates(now = Date.now()) {
    recent = recent.filter((r) => now - r.t < RATE_WINDOW_MS);
    const perActor = new Map(); // "limit|actor" -> count
    for (const r of recent) {
      const k = `${r.limit}|${r.actor}`;
      perActor.set(k, (perActor.get(k) || 0) + 1);
    }
    let changed = false;
    for (const [k, n] of perActor) {
      const [limit, actor] = k.split("|");
      if (n > Number(limit) && !bots.has(actor)) {
        bots.add(actor);
        changed = true;
      }
    }
    return changed;
  }

  // A kind 0 profile came in. Returns true if it flagged a new bot.
  function markProfile(pubkey, meta) {
    if (!isBotProfile(meta) || bots.has(pubkey)) return false;
    bots.add(pubkey);
    return true;
  }

  // A record from a bot, or a DVM response addressed to one (bots can be flagged later).
  function isBotItem(item) {
    return bots.has(item.actor) || Boolean(item.requester && bots.has(item.requester));
  }

  return {
    classify,
    addListing,
    lookupApp,
    rememberName,
    checkRates,
    markProfile,
    isBotItem,
    isBot: (pubkey) => bots.has(pubkey),
    counters,
  };
}
