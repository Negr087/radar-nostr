// Tests for the web of trust (worker/wot.js), with fake follow lists: no network.
// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRows } from "../worker/aggregate.js";
import { createTrust } from "../worker/wot.js";

// Readable fake pubkeys: pk("a") -> "aaaa…" (64 hex chars).
const pk = (c) => c.repeat(64);
const list = (author, follows, created_at = 1) => ({
  pubkey: author,
  created_at,
  tags: follows.map((f) => ["p", f]),
});

// Answers like a relay would: only the lists of the authors asked for.
function fakeRelay(events) {
  const calls = [];
  const fetchLists = async (authors) => {
    calls.push(authors);
    return events.filter((e) => authors.includes(e.pubkey));
  };
  return { fetchLists, calls };
}

test("trusted: seeds, who they follow, and who enough of the network follows", async () => {
  const [seed, a, b, c, d, e, spam, spam2] = ["1", "2", "3", "4", "5", "6", "7", "8"].map(pk);
  const { fetchLists } = fakeRelay([
    list(seed, [a, b]),
    list(a, [c, d]),
    list(b, [c, a]),
    // d isn't followed by a seed, but it's among the most followed: its list counts too.
    list(d, [e]),
    // Spam accounts follow each other; nobody in the network follows them.
    list(spam, [spam2]),
    list(spam2, [spam]),
  ]);
  const trust = createTrust({ fetchLists, seeds: [seed], minFollowers: 2, minSize: 1 });
  assert.equal(trust.isTrusted(a), null, "unknown before the first build");
  await trust.refresh();
  assert.equal(trust.isTrusted(seed), true);
  assert.equal(trust.isTrusted(a), true); // followed by the seed
  assert.equal(trust.isTrusted(c), true); // followed by a and b
  assert.equal(trust.isTrusted(d), false); // only a follows it
  assert.equal(trust.isTrusted(e), false); // only d follows it
  assert.equal(trust.isTrusted(spam), false);
  assert.equal(trust.size, 4);
});

test("uses each author's newest list and ignores self-follows and bad tags", async () => {
  const [seed, a, b, x] = ["1", "2", "3", "9"].map(pk);
  const { fetchLists } = fakeRelay([
    list(seed, [x], 1), // old list
    list(seed, [a, seed, "not-a-pubkey"], 2),
    list(a, [b]),
  ]);
  const trust = createTrust({ fetchLists, seeds: [seed], minFollowers: 1, minSize: 1 });
  await trust.refresh();
  assert.equal(trust.isTrusted(x), false);
  assert.equal(trust.isTrusted(a), true);
  assert.equal(trust.isTrusted(b), true); // minFollowers 1: followed by a
  assert.equal(trust.isTrusted("not-a-pubkey"), false);
});

test("batches the requests and survives failing or hanging ones", async () => {
  const seed = pk("1");
  const follows = Array.from({ length: 10 }, (_, i) => i.toString(16).padStart(64, "f"));
  let n = 0;
  const fetchLists = async (authors) => {
    n++;
    if (authors.includes(seed)) return [list(seed, follows)];
    if (n === 2) throw new Error("relay down");
    if (n === 3) return new Promise(() => {}); // never answers
    return [];
  };
  const trust = createTrust({ fetchLists, seeds: [seed], batch: 3, minSize: 1, timeoutMs: 20 });
  assert.equal(await trust.refresh(), 11);
  assert.equal(n, 1 + 4); // the seed, then 10 follows in batches of 3
});

test("a network too small (relays down) keeps the previous one", async () => {
  const [seed, a, b] = ["1", "2", "3"].map(pk);
  let events = [list(seed, [a, b])];
  const fetchLists = async (authors) => events.filter((e) => authors.includes(e.pubkey));
  const logs = [];
  const trust = createTrust({ fetchLists, seeds: [seed], minSize: 3, log: (m) => logs.push(m) });
  assert.equal(await trust.refresh(), 3);
  events = [];
  assert.equal(await trust.refresh(), 3);
  assert.equal(trust.isTrusted(a), true);
  assert.match(logs.at(-1), /keeping the previous one/);
});

test("refresh calls made during a build share it", async () => {
  const seed = pk("1");
  const { fetchLists, calls } = fakeRelay([list(seed, [])]);
  const trust = createTrust({ fetchLists, seeds: [seed], minSize: 1 });
  await Promise.all([trust.refresh(), trust.refresh()]);
  assert.equal(calls.length, 1);
});

test("author rows carry the trust flag only when it's known", () => {
  const rec = (actor) => ({ t: 0, cat: "social", appKey: "app:damus", actor, zap: null });
  const lookupApp = () => ({ name: "Damus", pictures: [] });
  const hash = (p) => `h-${p}`;
  const trusted = { alice: true, bob: false };
  const rows = buildRows([rec("alice"), rec("bob"), rec("carol")], lookupApp, hash, (p) =>
    p in trusted ? trusted[p] : null
  );
  const flag = (author) => rows.authors.find((r) => r.author === `h-${author}`).trusted;
  assert.equal(flag("alice"), true);
  assert.equal(flag("bob"), false);
  assert.equal(flag("carol"), undefined);
  // Without a web of trust, rows look like they always did.
  const plain = buildRows([rec("alice")], lookupApp, hash);
  assert.equal("trusted" in plain.authors[0], false);
});
