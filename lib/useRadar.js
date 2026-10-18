"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NDK, { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { createEngine, RATE_WINDOW_MS } from "./engine.js";
import { WATCHED_KINDS } from "./kinds.js";
import { safeJson } from "./nostr.js";
import { PROFILE_RELAYS, RELAYS, ZAPSTORE_KINDS, ZAPSTORE_RELAY, trimSlash } from "./relays.js";

export { RELAYS };

const FEED_MAX = 80; // items visible in the feed
const WINDOW_MS = RATE_WINDOW_MS; // bubbles window: last 5 min
const MINUTES_KEPT = 30; // minutes in the pulse chart
const FLUSH_MS = 600; // how often the UI repaints
const APP_RECENT_MAX = 15; // latest events kept per app (for the detail panel)
const ZAPS_MAX = 60; // zaps visible in the zap stream
const ZAPS_PER_FLUSH = 2; // live zaps are released a couple at a time so they flow in

let ndkSingleton = null;
function getNdk() {
  if (!ndkSingleton) ndkSingleton = new NDK({ explicitRelayUrls: RELAYS });
  return ndkSingleton;
}

export function useRadar() {
  const [feed, setFeed] = useState([]);
  const [apps, setApps] = useState([]); // [{key, name, picture, count, last}]
  const [pulse, setPulse] = useState([]); // [{minute, total, byCat}]
  const [stats, setStats] = useState({
    total: 0,
    tagged: 0,
    newApps: 0,
    relays: 0,
    relayList: [],
    bots: 0,
  });
  const [profiles, setProfiles] = useState({});
  const [zaps, setZaps] = useState([]); // [{id, t, sender, recipient, sats, comment, appKey, zapTo, noteId}]
  const [zapStats, setZapStats] = useState({ perMin: 0, sats: 0 });

  // Created once (useRef's argument would be rebuilt and thrown away on every render).
  const st = useRef(null);
  st.current ||= {
    startedAt: Date.now(),
    engine: createEngine({
      fetchListing: (filter) => getNdk().fetchEvent(filter, { groupable: true }),
    }),
    hits: [], // [{key, t, actor}]
    botsChanged: false,
    recentByApp: new Map(), // key -> latest events of that app
    zapQueue: [], // zaps waiting to be shown in the stream
    zapLog: [], // [{t, sats}] in the window, for the zap stream stats
    minutes: new Map(), // minuteTs -> {total, byCat}
    buffer: [],
    profileQueue: new Set(),
    profiles: {},
    total: 0,
  };

  useEffect(() => {
    const ndk = getNdk();
    const s = st.current;
    const engine = s.engine;
    let alive = true;
    let sub;
    let zapstoreSub;

    // `viaClient`: app to attribute the event to when it has no client tag of its own.
    function handleEvent(ev, viaClient) {
      // Startup events (last 5 min) use their real time;
      // live ones use arrival time (more reliable than other people's clocks).
      const createdMs = ev.created_at * 1000;
      const now = createdMs < s.startedAt ? createdMs : Date.now();
      const r = engine.classify(ev, { now, viaClient });
      if (!r) return;

      if (r.zap) {
        const { id, actor: sender, appKey, zapTo } = r;
        s.zapQueue.push({ id, t: now, sender, appKey, zapTo, ...r.zap });
        s.zapLog.push({ t: now, sats: r.zap.sats || 0 });
        for (const pk of [r.actor, r.zap.recipient]) {
          if (pk && !s.profiles[pk]) s.profileQueue.add(pk);
        }
      }

      s.total++;
      if (r.appKey) s.hits.push({ key: r.appKey, t: now, actor: r.actor });

      const minute = Math.floor(now / 60000) * 60000;
      const m = s.minutes.get(minute) || { total: 0, byCat: {} };
      m.total++;
      m.byCat[r.cat] = (m.byCat[r.cat] || 0) + 1;
      s.minutes.set(minute, m);

      if (!r.showInFeed) return;
      s.buffer.push(r);
      if (r.appKey) {
        const list = s.recentByApp.get(r.appKey) || [];
        list.unshift(r);
        list.sort((a, b) => b.t - a.t);
        s.recentByApp.set(r.appKey, list.slice(0, APP_RECENT_MAX));
      }
      if (!s.profiles[r.actor]) s.profileQueue.add(r.actor);
    }

    async function start() {
      await ndk.connect(2500).catch(() => {});
      if (!alive) return;

      // Preload app listings (31990) to attribute zaps and show logos.
      // We wait for them (with a cap) before subscribing, so zaps to apps
      // during startup are already recognized.
      const preload = ndk
        .fetchEvents({ kinds: [31990], limit: 500 })
        .then((evs) => evs.forEach((ev) => engine.addListing(ev)))
        .catch(() => {});
      await Promise.race([preload, new Promise((r) => setTimeout(r, 2000))]);
      if (!alive) return;

      // Start with the last 5 min so the screen isn't empty.
      sub = ndk.subscribe(
        { kinds: WATCHED_KINDS, since: Math.floor((s.startedAt - WINDOW_MS) / 1000) },
        { closeOnEose: false, groupable: false }
      );
      sub.on("event", (ev) => handleEvent(ev));

      zapstoreSub = ndk.subscribe(
        { kinds: ZAPSTORE_KINDS, since: Math.floor((s.startedAt - WINDOW_MS) / 1000) },
        {
          closeOnEose: false,
          groupable: false,
          relaySet: NDKRelaySet.fromRelayUrls([ZAPSTORE_RELAY], ndk),
        }
      );
      zapstoreSub.on("event", (ev) => handleEvent(ev, "Zapstore"));
    }

    start();

    // Periodic repaint: avoids re-rendering on every event.
    const flush = setInterval(() => {
      const now = Date.now();
      if (engine.checkRates(now)) s.botsChanged = true;

      s.hits = s.hits.filter((h) => now - h.t < WINDOW_MS && !engine.isBot(h.actor));
      for (const k of s.minutes.keys()) if (now - k > MINUTES_KEPT * 60000) s.minutes.delete(k);

      // Zap stream: startup zaps go in at once (history); live ones a couple per repaint.
      if (s.zapQueue.length || s.botsChanged) {
        s.zapQueue.sort((a, b) => a.t - b.t);
        let take = s.zapQueue.filter((z) => z.t < s.startedAt).length;
        take = Math.max(take, Math.min(ZAPS_PER_FLUSH, s.zapQueue.length));
        const fresh = s.zapQueue.splice(0, take);
        setZaps((prev) =>
          [...fresh, ...prev]
            .filter((z) => !engine.isBot(z.sender))
            .sort((a, b) => b.t - a.t)
            .slice(0, ZAPS_MAX)
        );
      }
      s.zapLog = s.zapLog.filter((z) => now - z.t < WINDOW_MS);
      setZapStats({
        perMin: Math.round((s.zapLog.length / (WINDOW_MS / 60000)) * 10) / 10,
        sats: s.zapLog.reduce((sum, z) => sum + z.sats, 0),
      });

      if (s.buffer.length || s.botsChanged) {
        // Sort by time: startup events arrive out of order across relays.
        // And remove what's already on screen from accounts just flagged as bots.
        const fresh = s.buffer.splice(0);
        s.botsChanged = false;
        setFeed((prev) =>
          [...fresh, ...prev]
            .filter((f) => !engine.isBotItem(f))
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
          .map(([key, c]) => ({ key, ...c, ...engine.lookupApp(key) }))
          .sort((a, b) => b.count - a.count)
      );

      const thisMinute = Math.floor(now / 60000) * 60000;
      const series = [];
      for (let i = MINUTES_KEPT - 1; i >= 0; i--) {
        const minute = thisMinute - i * 60000;
        series.push({ minute, ...(s.minutes.get(minute) || { total: 0, byCat: {} }) });
      }
      setPulse(series);

      // Only count listening relays, not profile ones.
      let up = new Set();
      try {
        up = new Set(ndk.pool.connectedRelays().map((r) => trimSlash(r.url)));
      } catch {}
      const relayList = RELAYS.map((url) => ({ url, up: up.has(trimSlash(url)) }));
      const connected = relayList.filter((r) => r.up).length;
      setStats({
        total: s.total,
        tagged: engine.counters.tagged,
        newApps: engine.counters.newApps,
        relays: connected,
        relayList,
        bots: engine.counters.botEvents,
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
          { closeOnEose: true, relaySet: NDKRelaySet.fromRelayUrls(PROFILE_RELAYS, ndk) }
        );
        const add = {};
        for (const ev of evs) {
          const meta = safeJson(ev.content);
          if (engine.markProfile(ev.pubkey, meta)) s.botsChanged = true;
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

    return () => {
      alive = false;
      clearInterval(flush);
      clearInterval(profileTimer);
      sub?.stop();
      zapstoreSub?.stop();
    };
  }, []);

  const getApp = useCallback((key) => st.current.engine.lookupApp(key), []);
  const getRecent = useCallback(
    (key) =>
      (st.current.recentByApp.get(key) || []).filter((f) => !st.current.engine.isBotItem(f)),
    []
  );

  return {
    feed,
    apps,
    pulse,
    stats,
    profiles,
    zaps,
    zapStats,
    getApp,
    getRecent,
  };
}
