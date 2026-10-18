// Bot detection, in three layers:
// 1. By app (client tag): bots that say so in their name, known spam and bridges.
// 2. By profile: NIP-24 lets an account flag itself with "bot": true.
// 3. By rate: an account with more than BOT_RATE notes in the 5 min window.
// An account caught by 2 or 3 stays flagged for the rest of the session.

import { normalizeName } from "./knownApps";

// Normalized names (see normalizeName).
const BLOCKED_CLIENTS = new Set([
  "mostr", // fediverse bridge: these are Mastodon posts, not Nostr app usage
  "orignexus8", // network of accounts posting product ads
  "jqw22githubio", // unknown client; its GitHub Pages site doesn't exist
  "zhenguojianapp", // unknown client (both spellings)
  "zhenguojian",
]);

export const BOT_RATE = 20;

// We only measure rate on notes: replaceable events (live streams, app listings)
// get republished often, and DVMs are automated on purpose.
export const RATE_KINDS = new Set([1, 6, 1111]);

export function isBotClient(name) {
  const n = normalizeName(name);
  return BLOCKED_CLIENTS.has(n) || n.endsWith("bot");
}

export function isBotProfile(meta) {
  return meta?.bot === true || meta?.bot === "true";
}
