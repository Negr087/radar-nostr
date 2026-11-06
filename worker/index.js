// Radar Nostr worker: listens to the relays 24/7 with the same engine as the web page
// and stores aggregated counts in Supabase every minute.
//
//   SUPABASE_URL=… SUPABASE_SECRET_KEY=… node worker/index.js
//   DRY_RUN=1 node worker/index.js   (prints what it would send, writes nothing)

import NDK, { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { refreshBlocklist } from "../lib/blocklist.js";
import { createEngine, RATE_WINDOW_MS } from "../lib/engine.js";
import { WATCHED_KINDS } from "../lib/kinds.js";
import { safeJson } from "../lib/nostr.js";
import {
  PROFILE_RELAYS,
  RELAYS,
  ZAPSTORE_KINDS,
  ZAPSTORE_RELAY,
  trimSlash,
} from "../lib/relays.js";
import { authorHasher } from "./aggregate.js";
import { createPipeline } from "./pipeline.js";
import { createSupabase } from "./supabase.js";
import { DEFAULT_SEEDS, createTrust } from "./wot.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const FLUSH_MS = Number(process.env.FLUSH_MS) || 60 * 1000;
// Records wait this long before being counted, so rate-based bot detection (which needs
// a few minutes of activity) can still drop them. Same as the engine's rate window.
const HOLD_MS = Number(process.env.HOLD_MS) || RATE_WINDOW_MS;
const PROFILE_BATCH = 100;
const PROFILES_CHECKED_MAX = 50000;
// Relays send something every few seconds; this much silence means the connections died
// without NDK noticing. The worker exits and Docker (restart: unless-stopped) starts it again.
const STALL_MS = Number(process.env.STALL_MS) || 10 * 60 * 1000;
// Follow lists change slowly: the web of trust is rebuilt once a day.
const WOT_REFRESH_MS = 24 * 60 * 60 * 1000;
// Seed accounts for the web of trust (hex pubkeys, comma separated), see worker/wot.js.
const WOT_SEEDS = (process.env.WOT_SEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Unique users are counted from hashed pubkeys. AUTHOR_SALT if set, otherwise the secret
// key (already secret and stable). Changing it makes everyone count as new for a week.
const hashAuthor = authorHasher(
  process.env.AUTHOR_SALT || process.env.SUPABASE_SECRET_KEY || "dry-run"
);

const log = (...args) => console.log(new Date().toISOString(), ...args);

const db = DRY_RUN
  ? null
  : createSupabase({ url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY });

const ndk = new NDK({ explicitRelayUrls: RELAYS });
const engine = createEngine({
  fetchListing: (filter) => ndk.fetchEvent(filter, { groupable: true }),
});

// Unique users only count accounts the network follows. Until the first build finishes
// (about 2 min, well within HOLD_MS) or if it never does, everyone counts, as before.
const trust = createTrust({
  seeds: WOT_SEEDS.length ? WOT_SEEDS : DEFAULT_SEEDS,
  fetchLists: async (authors) => [
    ...(await ndk.fetchEvents(
      { kinds: [3], authors },
      { closeOnEose: true, relaySet: NDKRelaySet.fromRelayUrls(PROFILE_RELAYS, ndk) }
    )),
  ],
  log,
});

const pipeline = createPipeline({
  engine,
  db,
  hashAuthor,
  isTrusted: trust.isTrusted,
  holdMs: HOLD_MS,
  stallMs: STALL_MS,
  log,
});
const profileQueue = new Set();
const profilesChecked = new Set();
const startedAt = new Date().toISOString();

function handleEvent(ev, viaClient) {
  pipeline.seen();
  // Live only, filed under arrival time (more reliable than other people's clocks).
  const r = engine.classify(ev, { now: Date.now(), viaClient });
  if (!r) return;
  pipeline.add(r);
  // Profiles can reveal bots ("…_bot"): check whoever would count for an app or a zap.
  if ((r.appKey || r.zap) && !profilesChecked.has(r.actor)) profileQueue.add(r.actor);
}

async function checkProfiles() {
  if (!profileQueue.size) return;
  const authors = [...profileQueue].slice(0, PROFILE_BATCH);
  authors.forEach((a) => {
    profileQueue.delete(a);
    profilesChecked.add(a);
  });
  // Sets keep insertion order: forget the oldest checks first.
  while (profilesChecked.size > PROFILES_CHECKED_MAX) {
    profilesChecked.delete(profilesChecked.values().next().value);
  }
  try {
    const evs = await ndk.fetchEvents(
      { kinds: [0], authors },
      { closeOnEose: true, relaySet: NDKRelaySet.fromRelayUrls(PROFILE_RELAYS, ndk) }
    );
    for (const ev of evs) engine.markProfile(ev.pubkey, safeJson(ev.content));
  } catch {}
}

async function tick() {
  if (pipeline.stalled()) {
    log(`no events for ${Math.round(STALL_MS / 60000)} min: exiting so the worker gets restarted`);
    await pipeline.flush({ final: true });
    process.exit(1);
  }
  await refreshBlocklist();
  await pipeline.flush();
  await heartbeat();
}

function heartbeat() {
  return pipeline.heartbeat({
    started: startedAt,
    relays: connectedRelays(),
    relaysTotal: RELAYS.length,
  });
}

function connectedRelays() {
  try {
    const up = new Set(ndk.pool.connectedRelays().map((r) => trimSlash(r.url)));
    return RELAYS.filter((u) => up.has(trimSlash(u))).length;
  } catch {
    return 0;
  }
}

async function main() {
  const mode = DRY_RUN ? " (dry run)" : "";
  log(`starting${mode} · ${RELAYS.length} relays · flush every ${FLUSH_MS / 1000}s`);
  await ndk.connect(5000).catch(() => {});
  log(`connected to ${connectedRelays()}/${RELAYS.length} relays`);

  // App listings first, so zaps to apps are recognized from the start. Registered as they
  // arrive, waiting at most 15 s: relays that never answer would otherwise block forever.
  let listings = 0;
  const preload = ndk.subscribe({ kinds: [31990], limit: 500 }, { closeOnEose: true });
  preload.on("event", (ev) => {
    engine.addListing(ev);
    listings++;
  });
  await new Promise((resolve) => {
    preload.on("eose", resolve);
    setTimeout(resolve, 15000);
  });
  log(`preloaded ${listings} app listings`);
  trust.refresh();
  setInterval(() => trust.refresh(), WOT_REFRESH_MS);
  const blocks = await refreshBlocklist();
  log(blocks == null ? "blocklist not loaded, using the built-in one" : `blocklist: ${blocks} entries`);

  // No backfill: counting only from now on avoids double counting after a restart.
  const since = Math.floor(Date.now() / 1000);
  ndk
    .subscribe({ kinds: WATCHED_KINDS, since }, { closeOnEose: false, groupable: false })
    .on("event", (ev) => handleEvent(ev));
  ndk
    .subscribe(
      { kinds: ZAPSTORE_KINDS, since },
      {
        closeOnEose: false,
        groupable: false,
        relaySet: NDKRelaySet.fromRelayUrls([ZAPSTORE_RELAY], ndk),
      }
    )
    .on("event", (ev) => handleEvent(ev, "Zapstore"));

  setInterval(checkProfiles, 5000);
  setInterval(tick, FLUSH_MS);
  heartbeat();
  // Status line every 10 minutes.
  setInterval(() => {
    const { tagged, newApps, botEvents } = engine.counters;
    const { totals } = pipeline;
    log(
      `status · relays ${connectedRelays()}/${RELAYS.length} · events ${totals.events}` +
        ` · counted ${totals.counted} · tagged ${tagged} · new apps ${newApps}` +
        ` · bots ${botEvents + totals.droppedBots} · flushes ${totals.flushes}` +
        ` · failures ${totals.failures} · trusted ${trust.size}`
    );
  }, 10 * 60 * 1000);
}

// A stray error in a library callback (NDK has had a few) shouldn't take down a 24/7
// listener and lose up to 5 minutes of pending counts: log it and keep going.
process.on("uncaughtException", (err) => log("uncaught error (continuing):", err.stack || err));
process.on("unhandledRejection", (err) => log("unhandled rejection (continuing):", err));

// On stop (docker stop / Ctrl+C), send what's pending instead of losing it.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log(`${signal}: final flush`);
    await pipeline.flush({ final: true });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
