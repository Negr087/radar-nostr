// Tests for relay tracking (worker/aggregate.js, worker/pipeline.js), the relays page data
// (lib/relaysPage.js) and the flow diagram layout (lib/sankey.js). Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LAG_MS, buildRows, bucketOf, isEmpty, mergeRows } from "../worker/aggregate.js";
import { createPipeline } from "../worker/pipeline.js";
import { relayMatrix, relayRows } from "../lib/relaysPage.js";
import { groupFlows, sankeyLayout } from "../lib/sankey.js";

const T = Date.UTC(2026, 10, 20, 12, 3);
const lookupApp = (key) => ({ name: key.slice(4), website: null, pictures: [] });
const rec = (over) => ({ t: T, cat: "social", appKey: null, zap: null, ...over });
const A = "wss://a.relay";
const B = "wss://b.relay";

test("buildRows counts deliveries, firsts, solos and delay per relay", () => {
  const rows = buildRows(
    [
      rec({ appKey: "app:damus", relays: { [A]: 0, [B]: 250 } }),
      rec({ appKey: "app:damus", relays: { [B]: 0 } }),
      rec({ relays: { [A]: 0, [B]: 5 * 60 * 1000 } }), // late replay: capped
      rec({}), // relays unknown: no relay rows
    ],
    lookupApp
  );
  const byRelay = Object.fromEntries(rows.relays.map((r) => [r.relay, r]));
  assert.deepEqual(
    { ...byRelay[A], bucket: undefined },
    { bucket: undefined, relay: A, events: 2, fastest: 2, solo: 0, lag_ms: 0 }
  );
  assert.equal(byRelay[B].events, 3);
  assert.equal(byRelay[B].fastest, 1);
  assert.equal(byRelay[B].solo, 1);
  assert.equal(byRelay[B].lag_ms, 250 + MAX_LAG_MS);
  const apps = Object.fromEntries(rows.relay_apps.map((r) => [`${r.relay}|${r.app_key}`, r.events]));
  assert.deepEqual(apps, { [`${A}|app:damus`]: 1, [`${B}|app:damus`]: 2 });
  assert.equal(rows.relays[0].bucket, bucketOf(T));
});

test("mergeRows adds relay rows and isEmpty sees them", () => {
  const one = buildRows([rec({ appKey: "app:x", relays: { [A]: 0, [B]: 100 } })], lookupApp);
  const merged = mergeRows(one, one);
  const b = merged.relays.find((r) => r.relay === B);
  assert.equal(b.events, 2);
  assert.equal(b.lag_ms, 200);
  assert.equal(merged.relay_apps.find((r) => r.relay === A).events, 2);
  const onlyRelays = { apps: [], zaps: [], categories: [], authors: [], app_info: [], relays: one.relays };
  assert.equal(isEmpty(onlyRelays), false);
});

test("the pipeline adds later copies of a pending event, not of a flushed one", async () => {
  const sent = [];
  const engine = {
    checkRates: () => false,
    isBotItem: () => false,
    lookupApp,
  };
  const db = { addActivity: async (rows) => sent.push(rows), heartbeat: async () => {} };
  const p = createPipeline({ engine, db, holdMs: 1000, stallMs: 60000 });
  p.add({ id: "e1", t: T, cat: "social", appKey: "app:x" }, A);
  p.delivered("e1", B, 120);
  p.delivered("e1", A, 500); // the first relay again: ignored
  p.delivered("nope", B, 10); // never counted: ignored
  await p.flush({ now: T + 2000 });
  p.delivered("e1", "wss://c.relay", 50); // already flushed: ignored
  await p.flush({ now: T + 4000 });
  assert.equal(sent.length, 1);
  const relays = Object.fromEntries(sent[0].relays.map((r) => [r.relay, r]));
  assert.deepEqual(Object.keys(relays).sort(), [A, B]);
  assert.equal(relays[B].lag_ms, 120);
  assert.equal(relays[A].fastest, 1);
});

test("the pipeline sends relay states with the heartbeat, and survives them failing", async () => {
  const calls = [];
  const db = {
    addActivity: async () => {},
    heartbeat: async (s) => calls.push(["beat", s]),
    relayStatus: async () => {
      throw new Error("no such function");
    },
  };
  const p = createPipeline({ engine: {}, db, holdMs: 0, stallMs: 1 });
  const ok = await p.heartbeat({ started: "x", relays: 1, relaysTotal: 2, relayStates: [{ relay: A, connected: true }] });
  assert.equal(ok, true);
  assert.deepEqual(calls, [["beat", { started: "x", relays: 1, relaysTotal: 2 }]]);
});

test("relayRows turns counts into shares, delay and status", () => {
  const rows = relayRows([
    { relay: "wss://b.relay/", events: 50, fastest: 10, solo: 0, lag_ms: 8000, total: 100, connected: false, since: null, status_age_seconds: 30 },
    { relay: A, events: 90, fastest: 90, solo: 5, lag_ms: 0, total: 100, connected: true, since: null, status_age_seconds: 30 },
    { relay: "wss://c.relay", events: 0, fastest: 0, solo: 0, lag_ms: 0, total: 100, connected: true, since: null, status_age_seconds: 9999 },
  ]);
  assert.deepEqual(rows.map((r) => r.host), ["a.relay", "b.relay", "c.relay"]);
  assert.equal(rows[0].share, 90);
  assert.equal(rows[0].lagMs, null); // never late
  assert.equal(rows[1].lagMs, 200); // 8000 ms over 40 late copies
  assert.deepEqual(rows.map((r) => r.status), ["up", "down", null]);
});

test("relayMatrix gives each app's share per relay, busiest app first", () => {
  const m = relayMatrix([
    { relay: A, app_key: "app:small", name: "Small", icon: null, events: 5, app_total: 10 },
    { relay: A, app_key: "app:big", name: "Big", icon: null, events: 40, app_total: 50 },
  ]);
  assert.deepEqual(m.apps.map((a) => a.key), ["app:big", "app:small"]);
  assert.equal(m.cells.get(`${A}|app:big`), 80);
});

const app = (key) => ({ key, name: key });
const flow = (from, to, users) => ({ from: app(from), to: app(to), users });

test("groupFlows folds the smaller apps into Other", () => {
  const grouped = groupFlows([flow("a", "x", 10), flow("b", "x", 5), flow("c", "y", 1)], 1);
  const key = (f) => `${f.from.key}>${f.to.key}:${f.users}`;
  assert.deepEqual(grouped.map(key).sort(), ["a>x:10", "other>other:1", "other>x:5"]);
});

test("sankeyLayout stacks nodes and gives bands matching edges", () => {
  const flows = [flow("a", "x", 6), flow("a", "y", 2), flow("b", "x", 2)];
  const { left, right, links } = sankeyLayout(flows, { height: 120, gap: 10 });
  assert.deepEqual(left.map((n) => [n.node.key, n.total]), [["a", 8], ["b", 2]]);
  assert.deepEqual(right.map((n) => [n.node.key, n.total]), [["x", 8], ["y", 2]]);
  // 10 users over 110 px (one gap of 10): 11 px each.
  assert.equal(left[0].y1 - left[0].y0, 88);
  for (const l of links) {
    assert.ok(Math.abs(l.sy1 - l.sy0 - l.users * 11) < 1e-9);
    assert.ok(Math.abs(l.ty1 - l.ty0 - l.users * 11) < 1e-9);
  }
  // Bands fill each node exactly, in order.
  const ax = links.find((l) => l.from.key === "a" && l.to.key === "x");
  assert.equal(ax.sy0, left[0].y0);
  assert.equal(ax.ty0, right[0].y0);
  const bx = links.find((l) => l.from.key === "b");
  assert.equal(bx.ty1, right[0].y1);
  assert.deepEqual(sankeyLayout([], {}), { left: [], right: [], links: [] });
});

test("a copy of an event with no delay given counts from when it arrived", async () => {
  const sent = [];
  const engine = { checkRates: () => false, isBotItem: () => false, lookupApp };
  const db = { addActivity: async (rows) => sent.push(rows), heartbeat: async () => {} };
  const p = createPipeline({ engine, db, holdMs: 1000, stallMs: 1 });
  p.add({ id: "e2", t: T, cat: "social" }, A);
  p.delivered("e2", B, undefined, T + 800);
  await p.flush({ now: T + 2000 });
  assert.equal(sent[0].relays.find((r) => r.relay === B).lag_ms, 800);
});

const fakeRelay = ({ status, wsState, retry = false }) => {
  const relay = {
    status,
    connects: 0,
    connectivity: {
      reconnectTimeout: retry ? 1 : undefined,
      ws: wsState == null ? undefined : { readyState: wsState },
      set _status(v) {
        relay.status = v;
      },
    },
    connect: async () => {
      relay.connects++;
    },
  };
  return relay;
};

test("revive reconnects only relays NDK left down with nothing scheduled", async () => {
  const { isAbandoned, revive } = await import("../lib/relayKeeper.js");
  const up = fakeRelay({ status: 5, wsState: 1 });
  const retrying = fakeRelay({ status: 1, wsState: 3, retry: true });
  const connecting = fakeRelay({ status: 4, wsState: 0 });
  const gaveUp = fakeRelay({ status: 1, wsState: 3 });
  const flapping = fakeRelay({ status: 3, wsState: 3 });
  const never = fakeRelay({ status: 1 });
  const all = [up, retrying, connecting, gaveUp, flapping, never];
  assert.deepEqual(all.map(isAbandoned), [false, false, false, true, true, true]);
  assert.equal(revive(all), 3);
  assert.deepEqual(all.map((r) => r.connects), [0, 0, 0, 1, 1, 1]);
  assert.equal(flapping.status, 1); // reset so NDK's connect() runs
});
