// Tests for the shared core (lib/engine.js and friends). Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { isBotClient, isBotProfile } from "../lib/bots.js";
import { createEngine } from "../lib/engine.js";
import { normalizeName } from "../lib/knownApps.js";
import { bolt11Sats } from "../lib/nostr.js";

let nextId = 0;
const PK = (n) => String(n).repeat(64).slice(0, 64);
function ev({ kind = 1, pubkey = PK(1), tags = [], content = "", created_at = 1_800_000_000 } = {}) {
  return { id: `ev${++nextId}`, kind, pubkey, tags, content, created_at };
}
// A zap receipt (9735) wrapping a zap request signed by `sender`.
function zapReceipt({ sender, recipient, sats = 21, requestTags = [], comment = "" }) {
  const request = { kind: 9734, pubkey: sender, content: comment, tags: requestTags };
  return ev({
    kind: 9735,
    pubkey: PK(9), // the LNURL server
    tags: [
      ["p", recipient],
      ["bolt11", `lnbc${sats * 10}n1pexample`],
      ["description", JSON.stringify(request)],
    ],
  });
}

test("bolt11Sats reads the amount from the invoice prefix", () => {
  assert.equal(bolt11Sats("lnbc210n1pj"), 21);
  assert.equal(bolt11Sats("lnbc10u1pj"), 1000);
  assert.equal(bolt11Sats("lnbc2500u1p"), 250000);
  assert.equal(bolt11Sats("lnbc1pvjluez"), null); // invoice without an amount
});

test("normalizeName merges spellings of the same app", () => {
  assert.equal(normalizeName("Amethyst 0.95.1"), "amethyst");
  assert.equal(normalizeName("Primal Android"), "primal");
  assert.equal(normalizeName("noStrudel"), "nostrudel");
  assert.equal(normalizeName("zap.stream"), "zapstream");
  assert.equal(normalizeName("0xchat"), "0xchat");
});

test("bot names and profiles", () => {
  for (const n of ["masto-bot", "orig-nexus9-t37", "zhenguojian-app", "zhenguo-web-watch", "PosterChan AI", "Mostr"]) {
    assert.equal(isBotClient(n), true, n);
  }
  for (const n of ["Amethyst", "Primal", "Zeus", "Nostrich"]) assert.equal(isBotClient(n), false, n);
  assert.equal(isBotProfile({ name: "candr_boost_bot" }), true);
  assert.equal(isBotProfile({ display_name: "Weather Bot" }), true);
  assert.equal(isBotProfile({ bot: true }), true);
  assert.equal(isBotProfile({ name: "Abbot" }), false);
  assert.equal(isBotProfile({ name: "botanist" }), false);
});

test("a client tag attributes the event to that app", () => {
  const engine = createEngine();
  const r = engine.classify(ev({ tags: [["client", "Amethyst"]], content: "gm" }));
  assert.equal(r.appKey, "app:amethyst");
  assert.equal(r.cat, "social");
  assert.equal(r.showInFeed, true);
  assert.equal(engine.lookupApp(r.appKey).name, "Amethyst");
  assert.equal(engine.counters.tagged, 1);
});

test("duplicates across relays are ignored", () => {
  const engine = createEngine();
  const e = ev({ tags: [["client", "Damus"]] });
  assert.ok(engine.classify(e));
  assert.equal(engine.classify(e), null);
});

test("blocked clients are dropped and counted as bots", () => {
  const engine = createEngine();
  assert.equal(engine.classify(ev({ tags: [["client", "orig-nexus8"]] })), null);
  assert.equal(engine.counters.botEvents, 1);
});

test("a generic note without an app stays out of the feed", () => {
  const engine = createEngine();
  const r = engine.classify(ev({ kind: 1, content: "hello" }));
  assert.equal(r.appKey, null);
  assert.equal(r.showInFeed, false);
});

test("a zap counts for the app it was sent from, with its amount", () => {
  const engine = createEngine();
  const r = engine.classify(
    zapReceipt({ sender: PK(2), recipient: PK(3), sats: 21, requestTags: [["client", "Primal iOS"]] })
  );
  assert.equal(r.appKey, "app:primal");
  assert.equal(r.actor, PK(2)); // the sender, not the LNURL server
  assert.equal(r.zap.sats, 21);
  assert.equal(r.zap.recipient, PK(3));
  assert.match(r.verb, /zapped 21 sats/);
});

test("a zap with no app reaches the zap stream but not the feed", () => {
  const engine = createEngine();
  const r = engine.classify(zapReceipt({ sender: PK(2), recipient: PK(3), sats: 1000 }));
  assert.equal(r.appKey, null);
  assert.equal(r.zap.sats, 1000);
  assert.equal(r.showInFeed, false);
});

test("self-zaps are ignored", () => {
  const engine = createEngine();
  assert.equal(engine.classify(zapReceipt({ sender: PK(2), recipient: PK(2) })), null);
});

test("a zap to a known app's pubkey counts for that app", () => {
  const engine = createEngine();
  engine.addListing(
    ev({ kind: 31990, pubkey: PK(5), tags: [["d", "x"], ["k", "1"]], content: '{"name":"Wisp"}' })
  );
  const r = engine.classify(zapReceipt({ sender: PK(2), recipient: PK(5), sats: 500 }));
  assert.equal(r.appKey, "app:wisp");
  assert.equal(r.zapTo, true);
});

test("accounts above the rate limit get flagged, and their DVM replies too", () => {
  const engine = createEngine();
  const now = 1_800_000_000_000;
  const spammer = PK(7);
  for (let i = 0; i < 11; i++) engine.classify(ev({ kind: 5300, pubkey: spammer }), { now });
  assert.equal(engine.checkRates(now), true);
  assert.equal(engine.isBot(spammer), true);
  assert.equal(engine.classify(ev({ kind: 5300, pubkey: spammer }), { now }), null);
  const reply = ev({ kind: 6300, pubkey: PK(8), tags: [["p", spammer]] });
  assert.equal(engine.classify(reply, { now }), null);
  // A person asking a handful of jobs is fine.
  for (let i = 0; i < 3; i++) engine.classify(ev({ kind: 5300, pubkey: PK(4) }), { now });
  engine.checkRates(now);
  assert.equal(engine.isBot(PK(4)), false);
});

test("bot profiles flag the account", () => {
  const engine = createEngine();
  assert.equal(engine.markProfile(PK(6), { name: "candr_boost_bot" }), true);
  assert.equal(engine.isBotItem({ actor: PK(6) }), true);
});

test("app listings: new ones count once, republished and nameless ones are quiet", () => {
  const engine = createEngine();
  const listing = () =>
    ev({ kind: 31990, pubkey: PK(5), tags: [["d", "app"]], content: '{"name":"Coolstr"}' });
  const first = engine.classify(listing());
  assert.equal(first.appKey, "app:coolstr");
  assert.equal(first.showInFeed, true);
  assert.equal(engine.counters.newApps, 1);
  const again = engine.classify(listing());
  assert.equal(again.showInFeed, false);
  assert.equal(engine.counters.newApps, 1);
  const nameless = engine.classify(ev({ kind: 31990, pubkey: PK(4), tags: [["d", "z"]] }));
  assert.equal(nameless.showInFeed, false);
});

test("viaClient attributes untagged events (Zapstore relay)", () => {
  const engine = createEngine();
  const r = engine.classify(ev({ kind: 30063 }), { viaClient: "Zapstore" });
  assert.equal(r.appKey, "app:zapstore");
  assert.equal(r.cat, "ecosystem");
});

test("app data (30078) counts for its app but stays out of the feed", () => {
  const engine = createEngine();
  const r = engine.classify(ev({ kind: 30078, tags: [["client", "zeus"]] }));
  assert.equal(r.appKey, "app:zeus");
  assert.equal(r.showInFeed, false);
});

test("malformed 31990 addresses in client tags are never fetched", () => {
  const asked = [];
  const engine = createEngine({ fetchListing: (f) => (asked.push(f), Promise.resolve(null)) });
  const bad = ["31990:abc:x", `31990:${PK(1)}`, `1:${PK(1)}:x`, `31990:${"G".repeat(64)}:x`];
  bad.forEach((addr, i) => engine.classify(ev({ tags: [["client", `Bad${i}`, addr]] })));
  assert.equal(asked.length, 0);
  engine.classify(ev({ tags: [["client", "Good", `31990:${PK(2)}:app`]] }));
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]["#d"], ["app"]);
});
