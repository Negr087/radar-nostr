// Tests for the worker's counting pipeline (worker/pipeline.js) and its Supabase client
// (worker/supabase.js), with a fake engine, database and fetch: no network. Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { setExtraBlocks } from "../lib/bots.js";
import { authorHasher } from "../worker/aggregate.js";
import { createPipeline } from "../worker/pipeline.js";
import { createSupabase } from "../worker/supabase.js";

const T = Date.UTC(2026, 9, 30, 12, 0);
const HOLD = 5 * 60 * 1000;
const rec = (over) => ({ t: T, cat: "social", appKey: "app:damus", actor: "alice", zap: null, ...over });

function fakeEngine({ bots = [] } = {}) {
  return {
    checkRates: () => false,
    isBotItem: (r) => bots.includes(r.actor),
    lookupApp: (key) => ({ name: key.slice(4), website: null, pictures: [] }),
  };
}

// Records every call; `fail` makes the next addActivity calls throw.
function fakeDb() {
  const db = {
    sent: [],
    heartbeats: [],
    fail: 0,
    async addActivity(rows) {
      if (db.fail > 0) {
        db.fail--;
        throw new Error("network down");
      }
      db.sent.push(rows);
    },
    async heartbeat(status) {
      db.heartbeats.push(status);
    },
  };
  return db;
}

const pipelineWith = (db, engine = fakeEngine()) =>
  createPipeline({ engine, db, hashAuthor: authorHasher("test"), holdMs: HOLD, stallMs: 600000 });

test("records wait out the hold before they're sent", async () => {
  const db = fakeDb();
  const p = pipelineWith(db);
  p.add(rec());
  assert.equal(await p.flush({ now: T + HOLD - 1 }), null);
  assert.equal(db.sent.length, 0);
  assert.equal(p.pending, 1);

  await p.flush({ now: T + HOLD });
  assert.equal(db.sent.length, 1);
  assert.equal(db.sent[0].apps[0].events, 1);
  assert.equal(db.sent[0].authors.length, 1);
  assert.equal(p.pending, 0);
  assert.equal(p.totals.counted, 1);
});

test("bots and apps blocked while waiting are dropped", async () => {
  const db = fakeDb();
  const p = pipelineWith(db, fakeEngine({ bots: ["spammer"] }));
  p.add(rec({ actor: "spammer" }));
  p.add(rec({ appKey: "app:lobbyspam" }));
  p.add(rec());
  setExtraBlocks([{ pattern: "lobbyspam", match: "exact" }]); // blocked after arriving
  try {
    await p.flush({ now: T + HOLD });
  } finally {
    setExtraBlocks([]);
  }
  assert.deepEqual(db.sent[0].apps.map((a) => a.app_key), ["app:damus"]);
  assert.equal(p.totals.droppedBots, 2);
});

test("a failed flush is kept, merged into the next one, and holds the heartbeat", async () => {
  const db = fakeDb();
  const p = pipelineWith(db);
  db.fail = 1;
  p.add(rec());
  await p.flush({ now: T + HOLD });
  assert.equal(db.sent.length, 0);
  assert.equal(p.hasUnsent, true);
  assert.equal(p.totals.failures, 1);
  // Counts aren't up to date: no heartbeat, so the page shows "counter offline".
  assert.equal(await p.heartbeat({ relays: 10 }), false);
  assert.equal(db.heartbeats.length, 0);

  p.add(rec({ t: T + 60000 }));
  await p.flush({ now: T + 60000 + HOLD });
  assert.equal(db.sent.length, 1);
  assert.equal(db.sent[0].apps[0].events, 2); // both flushes in one
  assert.equal(db.sent[0].authors.length, 1); // same author, same bucket: still one
  assert.equal(p.hasUnsent, false);
  assert.equal(await p.heartbeat({ relays: 10 }), true);
  assert.deepEqual(db.heartbeats, [{ relays: 10 }]);
});

test("the final flush (on stop) sends everything, held or not", async () => {
  const db = fakeDb();
  const p = pipelineWith(db);
  p.add(rec({ t: T }));
  p.add(rec({ t: T + HOLD, actor: "bob" }));
  await p.flush({ now: T + 1000, final: true });
  assert.equal(db.sent[0].apps[0].events, 2);
  assert.equal(p.pending, 0);
});

test("dry run: logs instead of sending, keeps nothing to retry", async () => {
  const lines = [];
  const p = createPipeline({
    engine: fakeEngine(),
    db: null,
    hashAuthor: authorHasher("test"),
    holdMs: HOLD,
    stallMs: 600000,
    log: (...args) => lines.push(args.join(" ")),
  });
  p.add(rec());
  assert.match(await p.flush({ now: T + HOLD }), /^1 events · 1 app rows/);
  assert.match(lines[0], /^\[dry run\]/);
  assert.equal(p.hasUnsent, false);
  assert.equal(await p.heartbeat({}), false);
});

test("stalled after the silence limit, until an event arrives", () => {
  const p = createPipeline({ engine: fakeEngine(), db: null, hashAuthor: null, holdMs: HOLD, stallMs: 1000 });
  p.seen(T);
  assert.equal(p.stalled(T + 1000), false);
  assert.equal(p.stalled(T + 1001), true);
  p.seen(T + 1001);
  assert.equal(p.stalled(T + 1500), false);
  assert.equal(p.totals.events, 2);
});

// Swaps global fetch for one that records requests and answers with `reply`.
async function withFetch(reply, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = "" } = reply;
    return new Response(status === 204 ? null : body, { status });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("supabase client: keys, RPC body and errors", async () => {
  await withFetch({ status: 204 }, async (calls) => {
    const legacy = createSupabase({ url: "https://x.supabase.co/", secretKey: "eyJlegacy" });
    assert.equal(await legacy.addActivity({ apps: [] }), null); // no body
    assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/rpc/add_activity");
    assert.equal(calls[0].init.headers.Authorization, "Bearer eyJlegacy");
    assert.deepEqual(JSON.parse(calls[0].init.body), { rows: { apps: [] } });

    // New sb_secret_ keys only go in apikey.
    const modern = createSupabase({ url: "https://x.supabase.co", secretKey: "sb_secret_abc" });
    await modern.heartbeat({ started: "s", relays: 9, relaysTotal: 12 });
    assert.equal(calls[1].init.headers.Authorization, undefined);
    assert.equal(calls[1].init.headers.apikey, "sb_secret_abc");
    assert.deepEqual(JSON.parse(calls[1].init.body), { started: "s", relays: 9, relays_total: 12 });
  });

  await withFetch({ status: 404, body: '{"code":"PGRST202"}' }, async () => {
    const db = createSupabase({ url: "https://x.supabase.co", secretKey: "sb_secret_abc" });
    await assert.rejects(db.heartbeat({}), /worker_heartbeat 404: \{"code":"PGRST202"\}/);
  });

  assert.throws(() => createSupabase({ url: "", secretKey: "k" }), /required/);
});

test("supabase client: blocklist edits", async () => {
  await withFetch({ body: '[{"pattern":"spamapp","match":"prefix"}]' }, async (calls) => {
    const db = createSupabase({ url: "https://x.supabase.co", secretKey: "sb_secret_abc" });
    const row = await db.addBlock({ pattern: "spamapp", match: "prefix", reason: null });
    assert.deepEqual(row, { pattern: "spamapp", match: "prefix" });
    assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/blocked_clients?on_conflict=pattern");
    assert.match(calls[0].init.headers.Prefer, /resolution=merge-duplicates/);

    await db.removeBlock("spam app&x");
    assert.equal(calls[1].init.method, "DELETE");
    assert.equal(calls[1].url, "https://x.supabase.co/rest/v1/blocked_clients?pattern=eq.spam%20app%26x");
  });
});
