# Radar Nostr

Live feed of which Nostr apps/clients people are using, minute by minute. Like zaplife.lol, but for apps.

Live at **[radarnostr.vercel.app](https://radarnostr.vercel.app)**.

## Run

```bash
npm install
npm run dev
# http://localhost:3000
```

Deploy: as-is to Vercel (everything runs in the browser, there's no backend). Every push to `main` deploys.

## How it detects activity

1. **`client` tag (NIP-89)**: if the event has one, it's attributed to that app. If it points to a `31990:pubkey:d`, the app listing is fetched (name, logo, website).
2. **Event kind**: with no tag, the event is classified by category (photo, article, live, git, DVM…). See `lib/kinds.js`.
3. **Ecosystem**: new apps (kind 31990 published live) and zaps to npubs of known apps.
4. **Zaps**: the receipt (9735) is signed by the Lightning server, so the app is read from the zap request inside it (`description` tag). A zap counts for the app that receives it or, if it goes to a person, for the app it was sent from. Zaps with neither are dropped.

On startup it preloads ~500 kind 31990 listings (to recognize zaps to apps) and fetches the last 5 minutes of events, so the screen doesn't start empty.

## Files

- `lib/useRadar.js`: relay connection (NDK), parsing, aggregates, batched profiles. The core lives here.
- `lib/kinds.js`: kind -> category/verb map. Add kinds here.
- `lib/bots.js`: bot detection (by app name, by `"bot": true` profile, and by posting rate). Their events don't count anywhere.
- `lib/knownApps.js`: known apps (name, website and verified icon) and name normalization so "Primal Android" and "Primal Web" are a single bubble. Add apps here.
- `components/Bubbles.js`: one bubble per app (area = activity over the last 5 min, beats on every event). They arrange themselves with a small simulation (pull to center + collisions) that sleeps when everything is still. Tapping one opens its details.
- `components/AppDetail.js`: panel with an app's details (website, activity over 5 min / hour / 24 h, latest events).
- `components/Ranking.js`: top 10 for the last hour and 24 h. Counted in 10 min buckets and stored in `localStorage`, so it only reflects what this browser saw while the page was open.
- `components/Feed.js`: live ticker (each item opens the event on njump.me).
- `components/Pulse.js`: per-minute bars stacked by category; the legend filters the feed.
- `app/opengraph-image.js` / `app/icon.js`: share preview image and tab icon, generated at build time.

## Quick tweaks

- Relays: `RELAYS` (live listening) and `PROFILE_RELAYS` (profiles) in `lib/useRadar.js`.
- Bubble window / feed length: constants at the top of `lib/useRadar.js`.
- Reactions (kind 7) are excluded because they flood everything; add them to `WATCHED_KINDS` if you want them.

## Next steps (v2)

- Node worker on the Umbrel node listening 24/7 + Supabase for daily/weekly rankings and history.
- Real ranking (not per browser) once the worker + Supabase exist.
