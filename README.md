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

- `lib/engine.js`: the core, shared by the page and the worker. Classifies each event (which app, bot or not, zap amount) with no React and no database.
- `lib/relays.js`: relay lists (live, profiles, Zapstore).
- `lib/nostr.js`: pure parsing helpers (zap invoices, app listings).
- `lib/useRadar.js`: the page's hook: connects to relays (NDK), feeds events to the engine, and builds what the UI shows (bubbles, feed, pulse, ranking, zap stream).
- `lib/kinds.js`: kind -> category/verb map. Add kinds here.
- `lib/bots.js`: bot detection (by app name, by `"bot": true` profile, and by posting rate). Their events don't count anywhere.
- `lib/format.js`: small display helpers (time ago, short npub, compact sats).
- `lib/knownApps.js`: known apps (name, website and verified icon) and name normalization so "Primal Android" and "Primal Web" are a single bubble. Add apps here.
- `components/Bubbles.js`: one bubble per app (area = activity over the last 5 min, beats on every event). They arrange themselves with a small simulation (pull to center + collisions) that sleeps when everything is still. Tapping one opens its details.
- `components/AppDetail.js`: panel with an app's details (website, activity over 5 min / hour / 24 h, latest events).
- `components/Ranking.js`: top 10 for the last hour and 24 h. Counted in 10 min buckets and stored in `localStorage`, so it only reflects what this browser saw while the page was open.
- `components/Feed.js`: live ticker (each item opens the event on njump.me).
- `components/Zaps.js`: zap stream with every zap (not only app-related ones), newest on top, bigger zaps glow more.
- `components/Pulse.js`: per-minute bars stacked by category; the legend filters the feed.
- `app/opengraph-image.js` / `app/icon.js`: share preview image and tab icon, generated at build time.

## Worker (v2)

`worker/` listens to the relays 24/7 with the same engine as the page and stores aggregated
counts in Supabase every minute (schema in `supabase/schema.sql`). Events wait 5 minutes
before being counted, so accounts caught by the rate-based bot filter don't make it in.

```bash
cp .env.example .env   # then fill in SUPABASE_SECRET_KEY
npm run worker         # DRY_RUN=1 npm run worker prints what it would send, writes nothing
```

### Running it 24/7 (Umbrel or any Docker host)

```bash
git clone https://github.com/Negr087/radar-nostr.git && cd radar-nostr
cp .env.example .env && nano .env && chmod 600 .env   # paste the secret key
docker compose -f worker/docker-compose.yml up -d --build
docker logs -f radar-nostr-worker                     # first "flushed" after ~6 min
```

Update: `git pull && docker compose -f worker/docker-compose.yml up -d --build`.
Run only one worker at a time: two would count every event twice.

## Tests

```bash
npm test
```

Covers the shared core: app attribution, zaps, bot detection, DVMs and app listings.

## Quick tweaks

- Relays: `RELAYS` (live listening) and `PROFILE_RELAYS` (profiles) in `lib/relays.js`.
- Bubble window / feed length: constants at the top of `lib/useRadar.js`.
- Reactions (kind 7) are excluded because they flood everything; add them to `WATCHED_KINDS` if you want them.

## Next steps (v2)

- Node worker on the Umbrel node listening 24/7 + Supabase for daily/weekly rankings and history.
- Real ranking (not per browser) once the worker + Supabase exist.
