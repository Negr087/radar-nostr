// Tests for the worker's aggregation (worker/aggregate.js). Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUCKET_MS, buildRows, bucketOf, isEmpty, mergeRows } from "../worker/aggregate.js";

const lookupApp = (key) => ({ name: key.slice(4), website: null, pictures: [`https://x/${key}.png`] });
const T = Date.UTC(2026, 9, 18, 12, 3); // 12:03 → bucket 12:00
const rec = (over) => ({ t: T, cat: "social", appKey: null, zap: null, ...over });

test("bucketOf rounds down to 10 minutes", () => {
  assert.equal(bucketOf(T), "2026-10-18T12:00:00.000Z");
  assert.equal(bucketOf(T + 7 * 60000), "2026-10-18T12:10:00.000Z");
});

test("buildRows counts per app, category and zaps", () => {
  const rows = buildRows(
    [
      rec({ appKey: "app:amethyst" }),
      rec({ appKey: "app:amethyst" }),
      rec({ appKey: "app:primal", cat: "zap", zap: { sats: 21 } }),
      rec({ cat: "zap", zap: { sats: 1000 } }), // zap with no app
      rec({}), // no app, no zap: only the category
      rec({ appKey: "app:amethyst", t: T + BUCKET_MS }), // next bucket
    ],
    lookupApp
  );
  const app = (key, b = bucketOf(T)) =>
    rows.apps.find((r) => r.app_key === key && r.bucket === b)?.events;
  assert.equal(app("app:amethyst"), 2);
  assert.equal(app("app:amethyst", bucketOf(T + BUCKET_MS)), 1);
  assert.equal(app("app:primal"), 1);
  assert.deepEqual(
    rows.zaps.map(({ app_key, zaps, sats }) => [app_key, zaps, sats]).sort(),
    [["", 1, 1000], ["app:primal", 1, 21]]
  );
  const social = (b) =>
    rows.categories.find((c) => c.category === "social" && c.bucket === b).events;
  assert.equal(social(bucketOf(T)), 3);
  assert.equal(social(bucketOf(T + BUCKET_MS)), 1);
  assert.equal(rows.app_info.find((a) => a.app_key === "app:primal").icon, "https://x/app:primal.png");
});

test("mergeRows adds up a failed flush with the next one", () => {
  const a = buildRows([rec({ appKey: "app:damus", zap: { sats: 10 }, cat: "zap" })], lookupApp);
  const b = buildRows([rec({ appKey: "app:damus", zap: { sats: 5 }, cat: "zap" })], lookupApp);
  const m = mergeRows(a, b);
  assert.equal(m.apps[0].events, 2);
  assert.equal(m.zaps[0].zaps, 2);
  assert.equal(m.zaps[0].sats, 15);
  assert.equal(m.categories[0].events, 2);
  assert.equal(m.app_info.length, 1);
});

test("isEmpty", () => {
  assert.equal(isEmpty(buildRows([], lookupApp)), true);
  assert.equal(isEmpty(buildRows([rec({})], lookupApp)), false);
});
