// Bot detection, in three layers:
// 1. By app (client tag): bots that say so in their name, known spam and bridges.
// 2. By profile: NIP-24 lets an account flag itself with "bot": true.
// 3. By rate: an account above the limit for its event type in the 5 min window
//    (BOT_RATE notes, or DVM_RATE DVM job requests).
// An account caught by 2 or 3 stays flagged for the rest of the session.

import { normalizeName } from "./knownApps";

// Normalized names (see normalizeName).
const BLOCKED_CLIENTS = new Set([
  "mostr", // fediverse bridge: these are Mastodon posts, not Nostr app usage
  "orignexus8", // network of accounts posting product ads
  "jqw22githubio", // unknown client; its GitHub Pages site doesn't exist
  "zhenguojianapp", // unknown client (both spellings)
  "zhenguojian",
  "posterchan", // automated posting account (seen as "PosterChan AI")
  "posterchanai",
  "sonarstatus", // automated status posts
]);

export const BOT_RATE = 20;
// A person asks a DVM for a handful of jobs; one account was seen polling every ~14 s.
export const DVM_RATE = 10;

const NOTE_KINDS = new Set([1, 6, 1111]);

// Max events per 5 min window for this kind, or null if we don't measure it.
// Replaceable events (live streams, app listings) get republished often, and
// DVM responses (6xxx) are automated on purpose, so they aren't measured.
export function rateLimitFor(kind) {
  if (NOTE_KINDS.has(kind)) return BOT_RATE;
  if (kind >= 5000 && kind <= 5999) return DVM_RATE;
  return null;
}

export function isBotClient(name) {
  const n = normalizeName(name);
  return BLOCKED_CLIENTS.has(n) || n.endsWith("bot");
}

export function isBotProfile(meta) {
  return meta?.bot === true || meta?.bot === "true";
}
