// Web of trust for unique user counts: an account only counts as a user if the Nostr
// network follows it. Spam networks can make thousands of fresh accounts, but real people
// don't follow them, so the user ranking gets hard to inflate.
//
// The network is built from follow lists (kind 3), starting at a few seed accounts:
//   1. the seeds' follow lists,
//   2. the lists of everyone the seeds follow,
//   3. the lists of the `expand` most followed accounts found so far.
// Trusted: the seeds, whoever a seed follows, and anyone followed by at least
// `minFollowers` of the lists fetched. Measured in Nov 2026: ~35k accounts, covering about
// 3 in 4 people posting from an app (most of the rest were bridged Mostr accounts).
// No network here: `fetchLists` is injected, so this can be tested.

const HEX64 = /^[0-9a-f]{64}$/;

// fiatjaf and jack: long-standing accounts with large, curated follow lists.
export const DEFAULT_SEEDS = [
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2",
];

// `fetchLists(authors)`: resolves to the kind 3 events those authors published (any
// number per author, the newest one is used). `minSize`: a smaller network means the
// relays didn't answer, so it isn't used.
export function createTrust({
  fetchLists,
  seeds = DEFAULT_SEEDS,
  minFollowers = 2,
  expand = 3000,
  batch = 30,
  parallel = 4,
  minSize = 5000,
  timeoutMs = 30000,
  log = () => {},
}) {
  let trusted = null; // Set of pubkeys, null until a build succeeds
  let building = null;

  // Newest follow list per author, as a list of followed pubkeys (deduplicated).
  async function listsOf(authors) {
    const newest = new Map();
    const batches = [];
    for (let i = 0; i < authors.length; i += batch) batches.push(authors.slice(i, i + batch));
    for (let i = 0; i < batches.length; i += parallel) {
      await Promise.all(
        batches.slice(i, i + parallel).map(async (b) => {
          // A batch that fails or hangs (a relay that never answers) just adds nothing:
          // the network is built from what came back.
          let timer;
          const events = await Promise.race([
            fetchLists(b).catch(() => []),
            new Promise((resolve) => (timer = setTimeout(() => resolve([]), timeoutMs))),
          ]);
          clearTimeout(timer);
          for (const ev of events) {
            if (!b.includes(ev.pubkey)) continue;
            const prev = newest.get(ev.pubkey);
            if (!prev || prev.created_at < ev.created_at) newest.set(ev.pubkey, ev);
          }
        })
      );
    }
    const out = new Map();
    for (const [pubkey, ev] of newest) {
      const follows = new Set();
      for (const t of ev.tags || []) if (t[0] === "p" && HEX64.test(t[1] || "")) follows.add(t[1]);
      follows.delete(pubkey); // following yourself proves nothing
      out.set(pubkey, follows);
    }
    return out;
  }

  async function build() {
    const started = Date.now();
    const followers = new Map(); // pubkey -> how many fetched lists follow it
    const asked = new Set(); // authors already requested, with or without a list back
    const level1 = new Set();
    let lists = 0;
    const fetchAndCount = async (authors) => {
      authors.forEach((a) => asked.add(a));
      const got = await listsOf(authors);
      lists += got.size;
      for (const follows of got.values()) {
        for (const p of follows) followers.set(p, (followers.get(p) || 0) + 1);
      }
      return got;
    };

    const seedLists = await fetchAndCount(seeds);
    for (const follows of seedLists.values()) for (const p of follows) level1.add(p);

    await fetchAndCount([...level1].filter((p) => !asked.has(p)));

    const top = [...followers]
      .filter(([p]) => !asked.has(p))
      .sort((a, b) => b[1] - a[1])
      .slice(0, expand)
      .map(([p]) => p);
    await fetchAndCount(top);

    const set = new Set([...seeds, ...level1]);
    for (const [p, n] of followers) if (n >= minFollowers) set.add(p);
    return { set, lists, ms: Date.now() - started };
  }

  return {
    // Trusted (true), not trusted (false), or not known yet (null: no network loaded).
    isTrusted: (pubkey) => (trusted ? trusted.has(pubkey) : null),
    get size() {
      return trusted ? trusted.size : 0;
    },

    // Builds the network again. Keeps the previous one if the new one comes back too
    // small (relays down). Returns the size in use, 0 if none. Calls made while a build
    // is running share it.
    refresh() {
      if (!building) {
        building = build()
          .then(({ set, lists, ms }) => {
            if (set.size < minSize) {
              log(`web of trust: only ${set.size} accounts from ${lists} lists, keeping the previous one`);
            } else {
              trusted = set;
              log(`web of trust: ${set.size} accounts from ${lists} follow lists in ${Math.round(ms / 1000)}s`);
            }
          })
          .catch((err) => log("web of trust failed:", err.message))
          .then(() => {
            building = null;
            return trusted ? trusted.size : 0;
          });
      }
      return building;
    },
  };
}
