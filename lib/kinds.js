// Kind -> activity category map.
// This is "layer 2": when an event has no `client` tag,
// its kind still tells us what type of app is being used.

export const CATEGORIES = {
  social: { label: "Social", color: "#a78bfa" },
  photo: { label: "Photos", color: "#f472b6" },
  video: { label: "Video", color: "#fb7185" },
  article: { label: "Articles", color: "#fbbf24" },
  live: { label: "Live", color: "#f87171" },
  dev: { label: "Dev / Git", color: "#34d399" },
  dvm: { label: "DVMs", color: "#22d3ee" },
  music: { label: "Music", color: "#e879f9" },
  market: { label: "Market", color: "#a3e635" },
  zap: { label: "Zaps", color: "#f7931a" },
  ecosystem: { label: "Ecosystem", color: "#60a5fa" },
  other: { label: "Other", color: "#94a3b8" },
};

const KIND_MAP = {
  1: { cat: "social", verb: "posted a note" },
  6: { cat: "social", verb: "reposted" },
  7: { cat: "social", verb: "reacted" },
  8: { cat: "other", verb: "awarded a badge", hint: "Badges" },
  20: { cat: "photo", verb: "posted a photo", hint: "Olas" },
  21: { cat: "video", verb: "posted a video" },
  22: { cat: "video", verb: "posted a short video" },
  1063: { cat: "photo", verb: "shared a file" },
  1018: { cat: "social", verb: "voted in a poll" },
  1068: { cat: "social", verb: "created a poll" },
  1111: { cat: "social", verb: "commented" },
  1222: { cat: "social", verb: "sent a voice note" },
  1311: { cat: "live", verb: "wrote in a live chat", hint: "zap.stream" },
  1337: { cat: "dev", verb: "shared code" },
  1617: { cat: "dev", verb: "sent a patch", hint: "ngit" },
  9041: { cat: "zap", verb: "created a zap goal" },
  9321: { cat: "zap", verb: "sent a nutzap", hint: "Cashu" },
  9735: { cat: "zap", verb: "received a zap" },
  9802: { cat: "article", verb: "highlighted a text", hint: "Highlighter" },
  30009: { cat: "other", verb: "created a badge", hint: "Badges" },
  30023: { cat: "article", verb: "published an article", hint: "Habla / YakiHonne" },
  30063: { cat: "ecosystem", verb: "released an app version", hint: "Zapstore" },
  // quiet: counts in bubbles and pulse, but stays out of the feed (hundreds per minute).
  30078: { cat: "other", verb: "saved app data", quiet: true },
  30311: { cat: "live", verb: "is streaming live", hint: "zap.stream" },
  30402: { cat: "market", verb: "posted a listing", hint: "Shopstr / Plebeian" },
  30617: { cat: "dev", verb: "announced a git repo", hint: "gitworkshop" },
  31922: { cat: "other", verb: "created a calendar event" },
  31923: { cat: "other", verb: "created a calendar event" },
  31337: { cat: "music", verb: "uploaded a track" },
  31989: { cat: "ecosystem", verb: "recommended an app" },
  31990: { cat: "ecosystem", verb: "published an app 🆕" },
  32267: { cat: "ecosystem", verb: "published an app", hint: "Zapstore" },
  34235: { cat: "video", verb: "posted a video" },
  34550: { cat: "social", verb: "created a community" },
  36787: { cat: "music", verb: "uploaded a track", hint: "Wavlake" },
  39089: { cat: "social", verb: "made a follow pack", hint: "following.space" },
};

export function describeKind(kind) {
  if (KIND_MAP[kind]) return KIND_MAP[kind];
  if (kind >= 5000 && kind <= 5999) return { cat: "dvm", verb: "requested a DVM job" };
  if (kind >= 6000 && kind <= 6999) return { cat: "dvm", verb: "replied as a DVM" };
  return { cat: "other", verb: `published a kind ${kind}` };
}

// Kinds we subscribe to.
// We leave out 7 (reactions) because there are too many and they drown everything,
// and 30315 (user statuses): almost all are automated "listening to…".
export const WATCHED_KINDS = [
  1, 6, 8, 20, 21, 22, 1018, 1063, 1068, 1111, 1222, 1311, 1337, 1617, 9041, 9321, 9735, 9802,
  30009, 30023, 30063, 30078, 30311, 30402, 30617, 31337, 31922, 31923, 31989, 31990, 32267,
  34235, 34550, 36787, 39089, 5000, 5001, 5002, 5050, 5100, 5300, 5302, 6050, 6100, 6300,
];
