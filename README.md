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
- `lib/blocklist.js`: extra blocked clients from the database (`blocked_clients`), reloaded every 10 min by the page and the worker, so new spam is blocked without a deploy.
- `lib/format.js`: small display helpers (time ago, short npub, compact sats).
- `lib/knownApps.js`: known apps (name, website and verified icon) and name normalization so "Primal Android" and "Primal Web" are a single bubble. Add apps here.
- `components/Bubbles.js`: one bubble per app (area = activity over the last 5 min, beats on every event). They arrange themselves with a small simulation (pull to center + collisions) that sleeps when everything is still. Tapping one opens its details.
- `components/AppDetail.js`: panel with an app's details (website, live activity, stored hour / 24 h / 7 days with a 24 h chart, latest events).
- `components/Ranking.js`: top 10 for the last hour, 24 h and 7 days, by events, zapped sats or unique users, with the trend vs. the previous period (shown from ±20%, and only when the worker covered both periods), plus the apps first seen in the period. Read from Supabase (counted 24/7 by the worker, the same for everyone). Its header shows how fresh the stored counts are and warns when the worker stops updating them.
- `lib/supabase.js` / `lib/useHistory.js`: read-only access to the database (public anon key) and the hooks for the rankings, the pulse history, the worker's status and each app's history.
- `components/Feed.js`: live ticker (each item opens the event on njump.me).
- `components/Zaps.js`: zap stream with every zap (not only app-related ones), newest on top, bigger zaps glow more.
- `components/Pulse.js`: bars stacked by category: per minute live, or the stored history for 24 h / 7 days; the legend filters the feed.
- `app/opengraph-image.js` / `app/icon.js`: share preview image and tab icon, generated at build time.
- `app/compare/` / `lib/comparePage.js`: two apps side by side (`/compare?a=primal&b=damus`): users, events, zaps and rank, plus their 24 h and 7 day curves (`components/LineChart.js`, plain SVG rendered on the server). With no apps given it compares today's top two.
- `components/TvMode.js`: kiosk / TV mode (`/?tv`): full screen, rotating between the bubbles, the ranking (24 h by users and by sats) and the zap stream. `/?tv=45` sets the seconds per view, `/?tv=zaps` (or `bubbles`, `ranking`) stays on one. Remote or keyboard: ← → change view, OK / Enter pauses, F (or double click) goes full screen. It keeps the screen awake where the browser allows it.
- `app/app/[name]/`: each app's own page (`/app/primal`) with its numbers, today's rank, a 24 h chart and its own share image, rebuilt at most every 5 minutes (`lib/appPage.js` loads the data). `/?app=primal` opens that app's details on the radar.

## Worker (v2)

`worker/` listens to the relays 24/7 with the same engine as the page and stores aggregated
counts in Supabase every minute (schema in `supabase/schema.sql`). Events wait 5 minutes
before being counted, so accounts caught by the rate-based bot filter don't make it in.

After every flush that went through it updates a heartbeat (`worker_status`); the page warns
"counter offline" when it's more than 5 minutes old. If no events arrive for 10 minutes
(dead relay connections), the worker sends what's pending and exits so Docker restarts it.

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

Unique users: for each app and bucket the worker also stores who posted, as a salted hash
of the pubkey (salt: `AUTHOR_SALT`, or the secret key if unset), never the pubkey. That
table (`app_authors`) can't be read from outside; the page only gets counts. Changing the
salt makes everyone count as a new user for the next 7 days.

Web of trust: only accounts the Nostr network follows count as users (`worker/wot.js`), so
a spam network can't inflate the user ranking with fresh accounts. Once a day the worker
builds the network from follow lists (kind 3): the seeds' lists (fiatjaf and jack by default,
or `WOT_SEEDS`), the lists of everyone they follow, and those of the 3,000 most followed
accounts found. Trusted: the seeds, whoever they follow, and anyone followed by at least 2 of
those lists, about 35k accounts (Nov 2026), built in ~2 min. Each author row is stored with
`trusted`; event counts don't change, and accounts nobody follows yet (brand new users) still
count for events but not as users. Until the first build finishes, or if the relays don't
answer, everyone counts, as before.

Storage: every day at 04:17 UTC a pg_cron job (`rollup_old_buckets()`) merges buckets older
than 15 days into hourly ones, so the free plan doesn't fill up.

### Blocking a spam client

```bash
npm run block -- add "swipe-rugdesk" --reason "app data sync, one account"
npm run block -- add "orig-nexus" --prefix     # every name starting with it
npm run block -- list
npm run block -- remove "swipe-rugdesk"
```

Page and worker pick it up within 10 minutes, and its stored counts drop out of the
rankings. Needs the secret key in `.env`. The built-in lists in `lib/bots.js` still apply.

## Public API

Free, no key, open CORS; responses are cached about a minute by Vercel's CDN.

- `GET /api/ranking?period=hour|day|week&by=events|sats|users|new&limit=10`: the ranking, with
  each app's page, website, icon, count and `trend_pct` vs. the previous period.
- `GET /api/apps/<name>`: one app's numbers (events, users, zaps, today's rank, last 24 h hourly).
- `GET /api/status`: whether the stored counts are up to date.
- `GET /api`: this list.

Code: `app/api/`, sharing `lib/ranking.js` with the page's ranking and `lib/appPage.js` with
the app pages.

## Tests

```bash
npm test
```

Covers the shared core (app attribution, zaps, bot detection, DVMs, app listings, blocklist),
the worker's aggregation and counting pipeline (hold, bot drops, retries after a failed flush,
heartbeat, stall check) and its Supabase client, with no network.

## Quick tweaks

- Relays: `RELAYS` (live listening) and `PROFILE_RELAYS` (profiles) in `lib/relays.js`.
- Bubble window / feed length: constants at the top of `lib/useRadar.js`.
- Reactions (kind 7) are excluded because they flood everything; add them to `WATCHED_KINDS` if you want them.

## Next steps (v2)

- Done: worker on the Umbrel node listening 24/7 + Supabase for rankings and history.
- Count Obelisk's groups once its relay admits a radar account.
