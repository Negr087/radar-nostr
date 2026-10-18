"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NDK, { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { describeKind, WATCHED_KINDS } from "./kinds";
import { isBotClient, isBotProfile, rateLimitFor } from "./bots";
import { KNOWN_APPS, appKeyFor, faviconsFor, normalizeName, safeUrl } from "./knownApps";

// Relays we listen to live. Tested in Oct 2026: primal, snort, ditto and
// nostr.net have the most traffic. nos.lol didn't respond in the test but it's big,
// so we keep it (NDK retries on its own). relay.nostr.band was removed: it doesn't connect.
export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://relay.ditto.pub",
  "wss://relay.nostr.net",
  "wss://nostr.wine",
  "wss://offchain.pub",
  "wss://nostr.oxtr.dev",
  "wss://nostr.bitcoiner.social",
  "wss://nostr-pub.wellorder.net",
];

// Relays to fetch profiles (kind 0) from. None has them all: in a test with real
// authors, each one found ~40% and the combination ~50% (the rest have no profile).
const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];

const trimSlash = (url) => url.replace(/\/+$/, "");
const LIVE_RELAYS = new Set(RELAYS.map(trimSlash));

const FEED_MAX = 80; // items visible in the feed
const WINDOW_MS = 5 * 60 * 1000; // bubbles window: last 5 min
const MINUTES_KEPT = 30; // minutes in the pulse chart
const FLUSH_MS = 600; // how often the UI repaints
const SEEN_MAX = 20000; // ids remembered to drop duplicates across relays
const APP_RECENT_MAX = 15; // latest events kept per app (for the detail panel)

// Ranking: per-app counts in 10 min buckets, stored in this browser.
// Only counts while the page is open (there's no backend yet).
const RANK_KEY = "radar-ranking-v1";
const BUCKET_MS = 10 * 60 * 1000;
const RANK_KEEP_MS = 24 * 60 * 60 * 1000;
const RANK_SAVE_MS = 10000;

function loadRanking() {
  try {
    const r = JSON.parse(localStorage.getItem(RANK_KEY));
    if (r && r.buckets && r.names) return { countedUntil: 0, ...r };
  } catch {}
  return { buckets: {}, names: {}, countedUntil: 0 };
}

function saveRanking(rank) {
  rank.countedUntil = Date.now();
  try {
    localStorage.setItem(RANK_KEY, JSON.stringify(rank));
  } catch {}
}

// A feed item from a bot, or a DVM response addressed to one.
function isBotItem(s, f) {
  return s.bots.has(f.actor) || (f.requester && s.bots.has(f.requester));
}

// Sums the buckets of the last `ms` and returns [{key, count}] sorted.
function topApps(rank, ms, now) {
  const totals = new Map();
  for (const [b, counts] of Object.entries(rank.buckets)) {
    if (now - Number(b) >= ms) continue;
    for (const [key, n] of Object.entries(counts)) totals.set(key, (totals.get(key) || 0) + n);
  }
  return [...totals].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

let ndkSingleton = null;
function getNdk() {
  if (!ndkSingleton) ndkSingleton = new NDK({ explicitRelayUrls: RELAYS });
  return ndkSingleton;
}

// Amount in sats of a Lightning invoice, read from the prefix: "lnbc210n1..." = 21 sats.
const BOLT11_UNIT = { "": 1e8, m: 1e5, u: 1e2, n: 1e-1, p: 1e-4 };
function bolt11Sats(invoice) {
  const m = /^ln(?:bc|tb|bcrt|tbs)(\d+)([munp]?)1/i.exec(invoice || "");
  return m ? Math.round(Number(m[1]) * BOLT11_UNIT[m[2].toLowerCase()]) : null;
}

function safeJson(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

// Turns a kind 31990 event (app listing, NIP-89) into a plain object.
function parseHandler(ev, fallbackName) {
  const meta = safeJson(ev?.content);
  const webTag = ev?.tags?.find((t) => t[0] === "web");
  const kinds = (ev?.tags || []).filter((t) => t[0] === "k").map((t) => Number(t[1]));
  return {
    name: meta.display_name || meta.name || fallbackName || null,
    picture: meta.picture || meta.image || null,
    about: meta.about || "",
    website: meta.website || (webTag ? webTag[1].split("<bech32>")[0] : null),
    kinds,
    pubkey: ev?.pubkey || null,
  };
}

// A DVM is an automated service: its listing only declares kinds 5000-6999.
function isDvmHandler(info) {
  return info.kinds.length > 0 && info.kinds.every((k) => k >= 5000 && k <= 6999);
}

// Registers a 31990 listing. Returns the app key, or null if it has no name
// (some systems publish hundreds of automated nameless listings).
function registerHandler(s, ev) {
  const info = parseHandler(ev);
  const key = appKeyFor(info.name);
  if (!key) return null;
  indexHandler(s, info);
  // Zaps to a DVM are payments for jobs, not support for an app.
  if (!isDvmHandler(info)) s.appByPubkey.set(ev.pubkey, key);
  return key;
}

// Stores the listing by normalized name, preferring one that has a logo.
function indexHandler(s, info) {
  const n = normalizeName(info.name);
  if (!n) return;
  const prev = s.handlersByName.get(n);
  if (!prev || (!prev.picture && info.picture)) s.handlersByName.set(n, info);
}

// Final info for an app, combining (in order): known apps map (verified icon),
// its own 31990 listing, any preloaded listing with the same name, and the website favicon.
// `pictures` is a list of candidates: Avatar tries them one after another.
function lookupApp(s, key) {
  if (!key) return null;
  const norm = key.startsWith("app:") ? key.slice(4) : null;
  const own = s.appInfo.get(key) || {};
  const known = norm ? KNOWN_APPS[norm] : null;
  const byName = norm ? s.handlersByName.get(norm) : null;
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

export function useRadar() {
  const [feed, setFeed] = useState([]);
  const [apps, setApps] = useState([]); // [{key, name, picture, count, last}]
  const [pulse, setPulse] = useState([]); // [{minute, total, byCat}]
  const [stats, setStats] = useState({ total: 0, tagged: 0, newApps: 0, relays: 0, bots: 0 });
  const [profiles, setProfiles] = useState({});
  const [ranking, setRanking] = useState({ hour: [], day: [] });

  const st = useRef({
    startedAt: Date.now(),
    seen: new Set(),
    appInfo: new Map(), // key -> info
    handlersByName: new Map(), // normalized name -> 31990 listing
    appByPubkey: new Map(), // app pubkey -> key (to attribute zaps)
    fetched: new Set(), // keys whose listing was already requested
    knownHandlers: new Set(), // "pubkey:d" of 31990 listings already seen
    hits: [], // [{key, t, actor}]
    recent: [], // [{actor, t}] notes in the window, to measure each account's rate
    bots: new Set(), // pubkeys detected as bots
    botsChanged: false,
    botEvents: 0,
    recentByApp: new Map(), // key -> latest events of that app
    rank: null,
    minutes: new Map(), // minuteTs -> {total, byCat}
    buffer: [],
    profileQueue: new Set(),
    profiles: {},
    total: 0,
    tagged: 0,
    newApps: 0,
  });

  useEffect(() => {
    const ndk = getNdk();
    const s = st.current;
    let alive = true;
    let sub;

    s.rank = loadRanking();
    // Anything before this was counted in a previous session (avoids double counting on reload).
    s.rankFrom = s.rank.countedUntil;
    // Names of apps seen in previous sessions, so the ranking doesn't say "Unnamed app".
    for (const [key, name] of Object.entries(s.rank.names)) {
      if (!s.appInfo.has(key)) s.appInfo.set(key, { name });
    }

    // If the client tag carries a 31990 address, fetch that listing (once per app).
    function resolveApp(key, address) {
      if (!address || s.fetched.has(key)) return;
      const [, pk, d] = address.split(":");
      if (!pk) return;
      s.fetched.add(key);
      ndk
        .fetchEvent({ kinds: [31990], authors: [pk], "#d": [d] }, { groupable: true })
        .then((h) => {
          if (!h) return;
          const info = parseHandler(h);
          s.appInfo.set(key, {
            ...s.appInfo.get(key),
            ...(info.name && { name: info.name }),
            picture: info.picture,
            website: info.website,
          });
          s.appByPubkey.set(h.pubkey, key);
        })
        .catch(() => {});
    }

    function handleEvent(ev) {
      if (s.seen.has(ev.id)) return;
      s.seen.add(ev.id);
      // Sets keep insertion order: drop the oldest, not all of them.
      if (s.seen.size > SEEN_MAX) s.seen.delete(s.seen.values().next().value);

      // Startup events (last 5 min) use their real time;
      // live ones use arrival time (more reliable than other people's clocks).
      const createdMs = ev.created_at * 1000;
      const now = createdMs < s.startedAt ? createdMs : Date.now();
      const desc = { ...describeKind(ev.kind) };
      let appKey = null;
      let appName = null;

      // In a zap, the receipt is signed by the LNURL server: the app that sent it
      // is in the zap request (description tag), not in the receipt.
      const zapReq = ev.kind === 9735 ? safeJson(ev.tags.find((t) => t[0] === "description")?.[1]) : null;
      const tags = zapReq ? (Array.isArray(zapReq.tags) ? zapReq.tags : []) : ev.tags;

      // Layer 1: client tag (NIP-89)
      const client = tags.find((t) => t[0] === "client" && t[1]);
      if (client && isBotClient(client[1])) {
        s.botEvents++;
        return;
      }
      if (client) {
        appName = client[1];
        appKey = appKeyFor(client[1]) || client[2] || `name:${client[1].toLowerCase()}`;
        if (!s.appInfo.has(appKey)) s.appInfo.set(appKey, { name: client[1] });
        resolveApp(appKey, client[2]);
        s.tagged++;
      }

      // Layer 3: ecosystem
      if (ev.kind === 31990) {
        // Only a "new app" the first time: DVMs republish their listing every few minutes.
        const d = ev.tags.find((t) => t[0] === "d")?.[1] || "";
        const address = `${ev.pubkey}:${d}`;
        const isNew = !s.knownHandlers.has(address);
        s.knownHandlers.add(address);
        const key = registerHandler(s, ev);
        if (!key || !isNew) desc.quiet = true;
        else {
          appKey = key;
          appName = lookupApp(s, key).name;
          s.newApps++;
        }
      }

      let actor = ev.pubkey;
      let zapTo = false;
      if (ev.kind === 9735) {
        const recipient = ev.tags.find((t) => t[0] === "p")?.[1];
        if (zapReq.pubkey) actor = zapReq.pubkey;
        // The real amount is in the invoice; the request's amount tag is optional.
        const amount = tags.find((t) => t[0] === "amount")?.[1];
        const sats =
          bolt11Sats(ev.tags.find((t) => t[0] === "bolt11")?.[1]) ??
          (amount ? Math.round(Number(amount) / 1000) : null);
        const satsTxt = sats ? ` ${sats.toLocaleString("en-US")} sats` : "";
        if (recipient && s.appByPubkey.has(recipient)) {
          // Zap to an app: counts for the app receiving it.
          zapTo = true;
          appKey = s.appByPubkey.get(recipient);
          appName = lookupApp(s, appKey).name;
          desc.verb = `zapped${satsTxt} to`;
        } else if (appKey) {
          // Zap to a person sent from an app that signs: counts for that app.
          desc.verb = sats ? `zapped${satsTxt}` : "sent a zap";
        } else {
          // Neither to an app nor from an identified app: that would just be zaplife again.
          return;
        }
      }

      // A DVM response (6xxx) is addressed to whoever asked (p tag): replies to a bot are noise too.
      const requester =
        ev.kind >= 6000 && ev.kind <= 6999 ? ev.tags.find((t) => t[0] === "p")?.[1] : null;
      if (s.bots.has(actor) || (requester && s.bots.has(requester))) {
        s.botEvents++;
        return;
      }
      const limit = rateLimitFor(ev.kind);
      if (limit) s.recent.push({ actor, t: now, limit });

      s.total++;
      if (appKey) {
        s.hits.push({ key: appKey, t: now, actor });
        // From startup, only what wasn't counted in a previous session.
        if (createdMs > s.rankFrom) {
          const b = Math.floor(now / BUCKET_MS) * BUCKET_MS;
          const counts = (s.rank.buckets[b] ||= {});
          counts[appKey] = (counts[appKey] || 0) + 1;
          if (appName && !s.rank.names[appKey]) s.rank.names[appKey] = appName;
        }
      }

      const minute = Math.floor(now / 60000) * 60000;
      const m = s.minutes.get(minute) || { total: 0, byCat: {} };
      m.total++;
      m.byCat[desc.cat] = (m.byCat[desc.cat] || 0) + 1;
      s.minutes.set(minute, m);

      // The feed gets: everything with an identified app + anything that isn't a generic kind 1/6
      const interesting = !desc.quiet && (appKey || ![1, 6, 1111].includes(ev.kind));
      if (!interesting) return;

      const item = {
        id: ev.id,
        kind: ev.kind,
        actor,
        requester,
        appKey,
        appName,
        cat: desc.cat,
        verb: desc.verb,
        zapTo,
        hint: !appKey ? desc.hint : null,
        preview: ev.kind === 1 || ev.kind === 1111 ? ev.content.slice(0, 140) : null,
        t: now,
      };
      s.buffer.push(item);
      if (appKey) {
        const list = s.recentByApp.get(appKey) || [];
        list.unshift(item);
        list.sort((a, b) => b.t - a.t);
        s.recentByApp.set(appKey, list.slice(0, APP_RECENT_MAX));
      }
      if (!s.profiles[actor]) s.profileQueue.add(actor);
    }

    async function start() {
      await ndk.connect(2500).catch(() => {});
      if (!alive) return;

      // Preload app listings (31990) to attribute zaps and show logos.
      // We wait for them (with a cap) before subscribing, so zaps to apps
      // during startup are already recognized.
      const preload = ndk
        .fetchEvents({ kinds: [31990], limit: 500 })
        .then((evs) => {
          for (const ev of evs) {
            const d = ev.tags.find((t) => t[0] === "d")?.[1] || "";
            s.knownHandlers.add(`${ev.pubkey}:${d}`);
            registerHandler(s, ev);
          }
        })
        .catch(() => {});
      await Promise.race([preload, new Promise((r) => setTimeout(r, 2000))]);
      if (!alive) return;

      // Start with the last 5 min so the screen isn't empty.
      sub = ndk.subscribe(
        { kinds: WATCHED_KINDS, since: Math.floor((s.startedAt - WINDOW_MS) / 1000) },
        { closeOnEose: false, groupable: false }
      );
      sub.on("event", handleEvent);
    }

    start();

    // Periodic repaint: avoids re-rendering on every event.
    const flush = setInterval(() => {
      const now = Date.now();
      // Rate: anyone above the limit for an event type in the window gets flagged as a bot.
      s.recent = s.recent.filter((r) => now - r.t < WINDOW_MS);
      const perActor = new Map(); // "limit|actor" -> count
      for (const r of s.recent) {
        const k = `${r.limit}|${r.actor}`;
        perActor.set(k, (perActor.get(k) || 0) + 1);
      }
      for (const [k, n] of perActor) {
        const [limit, actor] = k.split("|");
        if (n > Number(limit) && !s.bots.has(actor)) {
          s.bots.add(actor);
          s.botsChanged = true;
        }
      }

      s.hits = s.hits.filter((h) => now - h.t < WINDOW_MS && !s.bots.has(h.actor));
      for (const k of s.minutes.keys()) if (now - k > MINUTES_KEPT * 60000) s.minutes.delete(k);

      if (s.buffer.length || s.botsChanged) {
        // Sort by time: startup events arrive out of order across relays.
        // And remove what's already on screen from accounts just flagged as bots.
        const fresh = s.buffer.splice(0);
        s.botsChanged = false;
        setFeed((prev) =>
          [...fresh, ...prev]
            .filter((f) => !isBotItem(s, f))
            .sort((a, b) => b.t - a.t)
            .slice(0, FEED_MAX)
        );
      }

      const counts = new Map();
      for (const h of s.hits) {
        const c = counts.get(h.key) || { count: 0, last: 0 };
        c.count++;
        c.last = Math.max(c.last, h.t);
        counts.set(h.key, c);
      }
      setApps(
        [...counts.entries()]
          .map(([key, c]) => ({ key, ...c, ...lookupApp(s, key) }))
          .sort((a, b) => b.count - a.count)
      );

      const thisMinute = Math.floor(now / 60000) * 60000;
      const series = [];
      for (let i = MINUTES_KEPT - 1; i >= 0; i--) {
        const minute = thisMinute - i * 60000;
        series.push({ minute, ...(s.minutes.get(minute) || { total: 0, byCat: {} }) });
      }
      setPulse(series);

      let connected = 0;
      try {
        // Only count listening relays, not profile ones.
        connected = ndk.pool.connectedRelays().filter((r) => LIVE_RELAYS.has(trimSlash(r.url))).length;
      } catch {}
      setStats({
        total: s.total,
        tagged: s.tagged,
        newApps: s.newApps,
        relays: connected,
        bots: s.botEvents,
      });
    }, FLUSH_MS);

    // Profiles (kind 0) in batches, only for those who show up in the feed.
    const profileTimer = setInterval(async () => {
      if (!s.profileQueue.size) return;
      const authors = [...s.profileQueue].slice(0, 60);
      authors.forEach((a) => s.profileQueue.delete(a));
      try {
        const evs = await ndk.fetchEvents(
          { kinds: [0], authors },
          { closeOnEose: true },
          NDKRelaySet.fromRelayUrls(PROFILE_RELAYS, ndk)
        );
        const add = {};
        for (const ev of evs) {
          const meta = safeJson(ev.content);
          if (isBotProfile(meta) && !s.bots.has(ev.pubkey)) {
            s.bots.add(ev.pubkey);
            s.botsChanged = true;
          }
          add[ev.pubkey] = {
            name: meta.display_name || meta.name || null,
            picture: meta.picture || null,
          };
        }
        authors.forEach((a) => (add[a] ||= { name: null, picture: null }));
        Object.assign(s.profiles, add);
        if (alive) setProfiles({ ...s.profiles });
      } catch {}
    }, 2000);

    // Ranking: recompute, prune anything older than 24 h, and save.
    const rankTimer = setInterval(() => {
      const now = Date.now();
      for (const b of Object.keys(s.rank.buckets)) {
        if (now - Number(b) > RANK_KEEP_MS) delete s.rank.buckets[b];
      }
      const alive24h = new Set(Object.values(s.rank.buckets).flatMap(Object.keys));
      for (const key of Object.keys(s.rank.names)) if (!alive24h.has(key)) delete s.rank.names[key];
      const withInfo = (r) => ({ ...r, ...lookupApp(s, r.key) });
      setRanking({
        hour: topApps(s.rank, 60 * 60 * 1000, now).slice(0, 10).map(withInfo),
        day: topApps(s.rank, RANK_KEEP_MS, now).slice(0, 10).map(withInfo),
      });
      saveRanking(s.rank);
    }, RANK_SAVE_MS);

    return () => {
      alive = false;
      clearInterval(rankTimer);
      saveRanking(s.rank);
      clearInterval(flush);
      clearInterval(profileTimer);
      sub?.stop();
    };
  }, []);

  const getApp = useCallback((key) => lookupApp(st.current, key), []);
  const getRecent = useCallback(
    (key) => (st.current.recentByApp.get(key) || []).filter((f) => !isBotItem(st.current, f)),
    []
  );

  const getCounts = useCallback((key) => {
    const now = Date.now();
    const sum = (ms) => topApps(st.current.rank || { buckets: {} }, ms, now).find((r) => r.key === key)?.count || 0;
    return { hour: sum(60 * 60 * 1000), day: sum(RANK_KEEP_MS) };
  }, []);

  return { feed, apps, pulse, stats, profiles, ranking, getApp, getRecent, getCounts };
}
