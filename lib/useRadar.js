"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NDK, { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { describeKind, WATCHED_KINDS } from "./kinds";
import { BOT_RATE, RATE_KINDS, isBotClient, isBotProfile } from "./bots";
import { KNOWN_APPS, appKeyFor, faviconsFor, normalizeName, safeUrl } from "./knownApps";

// Relays que escuchamos en vivo. Probados en oct 2026: primal, snort, ditto y
// nostr.net son los de más tráfico. nos.lol no respondió en la prueba pero es grande,
// lo dejamos (NDK reintenta solo). relay.nostr.band se sacó: no conecta.
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

// Relays para pedir perfiles (kind 0). Ninguno los tiene todos: en una prueba con
// autores reales, cada uno encontró ~40% y la combinación ~50% (el resto no tiene perfil).
const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];

const trimSlash = (url) => url.replace(/\/+$/, "");
const LIVE_RELAYS = new Set(RELAYS.map(trimSlash));

const FEED_MAX = 80; // items visibles en el feed
const WINDOW_MS = 5 * 60 * 1000; // ventana de las burbujas: últimos 5 min
const MINUTES_KEPT = 30; // minutos en el gráfico de pulso
const FLUSH_MS = 600; // cada cuánto se repinta la UI
const SEEN_MAX = 20000; // ids recordados para descartar repetidos entre relays
const APP_RECENT_MAX = 15; // últimos eventos guardados por app (para el detalle)

// Ranking: conteo por app en tramos de 10 min, guardado en este navegador.
// Solo cuenta mientras la página está abierta (no hay backend todavía).
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

// Suma los tramos de los últimos `ms` y devuelve [{key, count}] ordenado.
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

// Monto en sats de una factura Lightning, leído del prefijo: "lnbc210n1..." = 21 sats.
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

// Convierte un evento kind 31990 (ficha de app, NIP-89) en un objeto simple.
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

// Un DVM es un servicio automático: su ficha solo declara kinds 5000-6999.
function isDvmHandler(info) {
  return info.kinds.length > 0 && info.kinds.every((k) => k >= 5000 && k <= 6999);
}

// Registra una ficha 31990. Devuelve la key de la app, o null si no tiene nombre
// (hay sistemas que publican cientos de fichas automáticas sin nombre).
function registerHandler(s, ev) {
  const info = parseHandler(ev);
  const key = appKeyFor(info.name);
  if (!key) return null;
  indexHandler(s, info);
  // Zaps a un DVM son pagos por trabajos, no apoyo a una app.
  if (!isDvmHandler(info)) s.appByPubkey.set(ev.pubkey, key);
  return key;
}

// Guarda la ficha por nombre normalizado, prefiriendo la que tiene logo.
function indexHandler(s, info) {
  const n = normalizeName(info.name);
  if (!n) return;
  const prev = s.handlersByName.get(n);
  if (!prev || (!prev.picture && info.picture)) s.handlersByName.set(n, info);
}

// Info final de una app, combinando (en orden): mapa de apps conocidas (ícono verificado),
// su propia ficha 31990, cualquier ficha precargada con el mismo nombre y el favicon de la web.
// `pictures` es una lista de candidatos: el Avatar prueba uno tras otro.
function lookupApp(s, key) {
  if (!key) return null;
  const norm = key.startsWith("app:") ? key.slice(4) : null;
  const own = s.appInfo.get(key) || {};
  const known = norm ? KNOWN_APPS[norm] : null;
  const byName = norm ? s.handlersByName.get(norm) : null;
  const website = safeUrl(known?.website) || safeUrl(own.website) || safeUrl(byName?.website);
  return {
    name: known?.name || own.name || byName?.name || "App sin nombre",
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
    handlersByName: new Map(), // nombre normalizado -> ficha 31990
    appByPubkey: new Map(), // pubkey de la app -> key (para atribuir zaps)
    fetched: new Set(), // keys cuya ficha ya se pidió
    knownHandlers: new Set(), // "pubkey:d" de fichas 31990 ya vistas
    hits: [], // [{key, t, actor}]
    recent: [], // [{actor, t}] notas de la ventana, para medir el ritmo de cada cuenta
    bots: new Set(), // pubkeys detectadas como bot
    botsChanged: false,
    botEvents: 0,
    recentByApp: new Map(), // key -> últimos eventos de esa app
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
    // Lo anterior a esto ya se contó en una sesión previa (evita contar dos veces al recargar).
    s.rankFrom = s.rank.countedUntil;
    // Nombres de apps vistas en sesiones anteriores, para que el ranking no diga "App sin nombre".
    for (const [key, name] of Object.entries(s.rank.names)) {
      if (!s.appInfo.has(key)) s.appInfo.set(key, { name });
    }

    // Si el tag client trae dirección 31990, bajamos esa ficha (una vez por app).
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
      // El Set respeta el orden de inserción: borramos el más viejo, no todos.
      if (s.seen.size > SEEN_MAX) s.seen.delete(s.seen.values().next().value);

      // Los eventos del arranque (últimos 5 min) van con su hora real;
      // los que llegan en vivo, con la hora de llegada (más fiel que relojes ajenos).
      const createdMs = ev.created_at * 1000;
      const now = createdMs < s.startedAt ? createdMs : Date.now();
      const desc = { ...describeKind(ev.kind) };
      let appKey = null;
      let appName = null;

      // En un zap, el recibo lo firma el servidor LNURL: la app que lo mandó
      // está en el pedido de zap (tag description), no en el recibo.
      const zapReq = ev.kind === 9735 ? safeJson(ev.tags.find((t) => t[0] === "description")?.[1]) : null;
      const tags = zapReq ? (Array.isArray(zapReq.tags) ? zapReq.tags : []) : ev.tags;

      // Capa 1: tag client (NIP-89)
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

      // Capa 3: ecosistema
      if (ev.kind === 31990) {
        // Solo es "app nueva" la primera vez: los DVMs re-publican su ficha cada pocos minutos.
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
        // El monto real está en la factura; el tag amount del pedido es opcional.
        const amount = tags.find((t) => t[0] === "amount")?.[1];
        const sats =
          bolt11Sats(ev.tags.find((t) => t[0] === "bolt11")?.[1]) ??
          (amount ? Math.round(Number(amount) / 1000) : null);
        const satsTxt = sats ? ` ${sats.toLocaleString("es-AR")} sats` : "";
        if (recipient && s.appByPubkey.has(recipient)) {
          // Zap a una app: cuenta para la app que lo recibe.
          zapTo = true;
          appKey = s.appByPubkey.get(recipient);
          appName = lookupApp(s, appKey).name;
          desc.verb = `le zapeó${satsTxt} a`;
        } else if (appKey) {
          // Zap a una persona mandado desde una app que firma: cuenta para esa app.
          desc.verb = sats ? `zapeó${satsTxt}` : "mandó un zap";
        } else {
          // Ni a una app ni con app identificada: sería zaplife de nuevo.
          return;
        }
      }

      if (s.bots.has(actor)) {
        s.botEvents++;
        return;
      }
      if (RATE_KINDS.has(ev.kind)) s.recent.push({ actor, t: now });

      s.total++;
      if (appKey) {
        s.hits.push({ key: appKey, t: now, actor });
        // Del arranque, solo lo que no se contó en una sesión anterior.
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

      // Al feed van: todo lo que tenga app identificada + lo que no sea kind 1/6 genérico
      const interesting = !desc.quiet && (appKey || ![1, 6, 1111].includes(ev.kind));
      if (!interesting) return;

      const item = {
        id: ev.id,
        kind: ev.kind,
        actor,
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

      // Precargamos fichas de apps (31990) para poder atribuir zaps y mostrar logos.
      // Las esperamos (con tope) antes de suscribirnos, así los zaps a apps del
      // arranque ya se reconocen.
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

      // Arrancamos con los últimos 5 min para no mostrar la pantalla vacía.
      sub = ndk.subscribe(
        { kinds: WATCHED_KINDS, since: Math.floor((s.startedAt - WINDOW_MS) / 1000) },
        { closeOnEose: false, groupable: false }
      );
      sub.on("event", handleEvent);
    }

    start();

    // Repintado periódico: evita re-renderizar por cada evento.
    const flush = setInterval(() => {
      const now = Date.now();
      // Ritmo: quien supera BOT_RATE notas en la ventana queda marcado como bot.
      s.recent = s.recent.filter((r) => now - r.t < WINDOW_MS);
      const perActor = new Map();
      for (const r of s.recent) perActor.set(r.actor, (perActor.get(r.actor) || 0) + 1);
      for (const [actor, n] of perActor) {
        if (n > BOT_RATE && !s.bots.has(actor)) {
          s.bots.add(actor);
          s.botsChanged = true;
        }
      }

      s.hits = s.hits.filter((h) => now - h.t < WINDOW_MS && !s.bots.has(h.actor));
      for (const k of s.minutes.keys()) if (now - k > MINUTES_KEPT * 60000) s.minutes.delete(k);

      if (s.buffer.length || s.botsChanged) {
        // Ordenamos por hora: los del arranque llegan desordenados entre relays.
        // Y sacamos lo que ya estaba en pantalla de cuentas recién marcadas como bot.
        const fresh = s.buffer.splice(0);
        s.botsChanged = false;
        setFeed((prev) =>
          [...fresh, ...prev]
            .filter((f) => !s.bots.has(f.actor))
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
        // Solo contamos los de escucha, no los de perfiles.
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

    // Perfiles (kind 0) en lote, solo de quienes aparecen en el feed.
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

    // Ranking: recalcula, poda lo de más de 24 h y guarda.
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
    (key) => (st.current.recentByApp.get(key) || []).filter((f) => !st.current.bots.has(f.actor)),
    []
  );

  const getCounts = useCallback((key) => {
    const now = Date.now();
    const sum = (ms) => topApps(st.current.rank || { buckets: {} }, ms, now).find((r) => r.key === key)?.count || 0;
    return { hour: sum(60 * 60 * 1000), day: sum(RANK_KEEP_MS) };
  }, []);

  return { feed, apps, pulse, stats, profiles, ranking, getApp, getRecent, getCounts };
}
