// Relay lists, shared by the web page and the worker.

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
  // Wallet of Satoshi publishes its zap receipts here (zaplife.lol listens to it too).
  // It refused connections from our test machine; NDK just skips it if it can't connect.
  "wss://nostr.walletofsatoshi.com",
];

// Relays to fetch profiles (kind 0) from. None has them all: in a test with real
// authors, each one found ~40% and the combination ~50% (the rest have no profile).
export const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];

// Zapstore publishes app listings and releases (32267 / 30063) on its own relay, without a
// client tag: everything we get from there is Zapstore activity. It rejects broad filters,
// so it gets its own small subscription.
export const ZAPSTORE_RELAY = "wss://relay.zapstore.dev";
export const ZAPSTORE_KINDS = [32267, 30063];

export const trimSlash = (url) => url.replace(/\/+$/, "");
