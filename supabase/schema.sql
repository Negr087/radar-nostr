-- Radar Nostr: database schema (Supabase / Postgres).
-- Paste it whole into Supabase → SQL Editor → Run. It's safe to run again.
--
-- Everything is aggregated counts in 10 minute buckets: no raw events, no note content.
-- Anyone can read (the web page uses the public anon key); only the worker writes,
-- with the secret service_role key, which bypasses RLS.

-- Activity per app (events attributed to it) per bucket.
create table if not exists app_activity (
  bucket timestamptz not null,
  app_key text not null,
  events integer not null default 0,
  primary key (bucket, app_key)
);

-- Zaps per bucket. app_key = '' for zaps with no identified app.
create table if not exists zap_activity (
  bucket timestamptz not null,
  app_key text not null default '',
  zaps integer not null default 0,
  sats bigint not null default 0,
  primary key (bucket, app_key)
);

-- All events per category (social, photo, zap…) per bucket, for the pulse/history charts.
create table if not exists category_activity (
  bucket timestamptz not null,
  category text not null,
  events integer not null default 0,
  primary key (bucket, category)
);

-- Display info for every app the worker has seen.
create table if not exists apps (
  app_key text primary key,
  name text not null,
  website text,
  icon text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists app_activity_app_bucket on app_activity (app_key, bucket);

-- Read-only access for everyone; no write policies, so only service_role can write.
alter table app_activity enable row level security;
alter table zap_activity enable row level security;
alter table category_activity enable row level security;
alter table apps enable row level security;

drop policy if exists "public read" on app_activity;
drop policy if exists "public read" on zap_activity;
drop policy if exists "public read" on category_activity;
drop policy if exists "public read" on apps;
create policy "public read" on app_activity for select using (true);
create policy "public read" on zap_activity for select using (true);
create policy "public read" on category_activity for select using (true);
create policy "public read" on apps for select using (true);

-- Each app's authors per bucket, for unique user counts. `author` is a salted hash of the
-- pubkey (see worker/aggregate.js), never the pubkey. Not readable by anyone: the page only
-- gets counts, through the functions below.
create table if not exists app_authors (
  bucket timestamptz not null,
  app_key text not null,
  author bigint not null,
  primary key (bucket, app_key, author)
);

alter table app_authors enable row level security;

-- Whether the author is followed by the Nostr network (web of trust, see worker/wot.js).
-- Only trusted authors count as users. Rows from before this column count as trusted.
alter table app_authors add column if not exists trusted boolean not null default true;

-- Events per platform, for apps whose client name says it ("Primal iOS", "Primal Web").
-- Only events that named a platform: the rest of the app's events didn't say.
create table if not exists platform_activity (
  bucket timestamptz not null,
  app_key text not null,
  platform text not null,
  events integer not null default 0,
  primary key (bucket, app_key, platform)
);

alter table platform_activity enable row level security;
drop policy if exists "public read" on platform_activity;
create policy "public read" on platform_activity for select using (true);

-- Per relay: the counted events it delivered (`events`), how many it delivered before any
-- other relay (`fastest`; every event has exactly one, so their sum is all events), how
-- many no other relay delivered (`solo`), and the total delay of the copies it delivered
-- after another relay (`lag_ms`, each capped at a minute; there are events - fastest).
create table if not exists relay_activity (
  bucket timestamptz not null,
  relay text not null,
  events integer not null default 0,
  fastest integer not null default 0,
  solo integer not null default 0,
  lag_ms bigint not null default 0,
  primary key (bucket, relay)
);

-- Per relay and app: the app's counted events that relay delivered.
create table if not exists relay_app_activity (
  bucket timestamptz not null,
  relay text not null,
  app_key text not null,
  events integer not null default 0,
  primary key (bucket, relay, app_key)
);

-- Whether the worker is connected to each relay right now, and since when.
create table if not exists relay_status (
  relay text primary key,
  connected boolean not null,
  since timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table relay_activity enable row level security;
alter table relay_app_activity enable row level security;
alter table relay_status enable row level security;
drop policy if exists "public read" on relay_activity;
drop policy if exists "public read" on relay_app_activity;
drop policy if exists "public read" on relay_status;
create policy "public read" on relay_activity for select using (true);
create policy "public read" on relay_app_activity for select using (true);
create policy "public read" on relay_status for select using (true);

-- For the user overlap and retention functions below.
create index if not exists app_authors_app_bucket on app_authors (app_key, bucket);
create index if not exists app_authors_author on app_authors (author);

-- Worker: adds one flush worth of counts (increments, so several flushes can share a bucket).
-- rows: {"apps":[{bucket,app_key,events}], "zaps":[{bucket,app_key,zaps,sats}],
--        "categories":[{bucket,category,events}], "authors":[{bucket,app_key,author,trusted?}],
--        "platforms":[{bucket,app_key,platform,events}], "app_info":[{app_key,name,website,icon}],
--        "relays":[{bucket,relay,events,fastest,solo,lag_ms}], "relay_apps":[{bucket,relay,app_key,events}]}
create or replace function add_activity(rows jsonb) returns void
language sql as $$
  insert into app_activity (bucket, app_key, events)
  select (r->>'bucket')::timestamptz, r->>'app_key', (r->>'events')::int
  from jsonb_array_elements(coalesce(rows->'apps', '[]')) r
  on conflict (bucket, app_key) do update set events = app_activity.events + excluded.events;

  insert into zap_activity (bucket, app_key, zaps, sats)
  select (r->>'bucket')::timestamptz, coalesce(r->>'app_key', ''), (r->>'zaps')::int, (r->>'sats')::bigint
  from jsonb_array_elements(coalesce(rows->'zaps', '[]')) r
  on conflict (bucket, app_key) do update
    set zaps = zap_activity.zaps + excluded.zaps, sats = zap_activity.sats + excluded.sats;

  insert into category_activity (bucket, category, events)
  select (r->>'bucket')::timestamptz, r->>'category', (r->>'events')::int
  from jsonb_array_elements(coalesce(rows->'categories', '[]')) r
  on conflict (bucket, category) do update set events = category_activity.events + excluded.events;

  -- No `trusted` (worker without a web of trust yet): counts as trusted, as before.
  -- Trusted once in a bucket stays trusted.
  insert into app_authors (bucket, app_key, author, trusted)
  select (r->>'bucket')::timestamptz, r->>'app_key', (r->>'author')::bigint,
         coalesce((r->>'trusted')::boolean, true)
  from jsonb_array_elements(coalesce(rows->'authors', '[]')) r
  on conflict (bucket, app_key, author) do update
    set trusted = app_authors.trusted or excluded.trusted
    where not app_authors.trusted and excluded.trusted;

  insert into platform_activity (bucket, app_key, platform, events)
  select (r->>'bucket')::timestamptz, r->>'app_key', r->>'platform', (r->>'events')::int
  from jsonb_array_elements(coalesce(rows->'platforms', '[]')) r
  on conflict (bucket, app_key, platform) do update
    set events = platform_activity.events + excluded.events;

  insert into relay_activity (bucket, relay, events, fastest, solo, lag_ms)
  select (r->>'bucket')::timestamptz, r->>'relay', (r->>'events')::int, (r->>'fastest')::int,
         (r->>'solo')::int, (r->>'lag_ms')::bigint
  from jsonb_array_elements(coalesce(rows->'relays', '[]')) r
  on conflict (bucket, relay) do update
    set events = relay_activity.events + excluded.events,
        fastest = relay_activity.fastest + excluded.fastest,
        solo = relay_activity.solo + excluded.solo,
        lag_ms = relay_activity.lag_ms + excluded.lag_ms;

  insert into relay_app_activity (bucket, relay, app_key, events)
  select (r->>'bucket')::timestamptz, r->>'relay', r->>'app_key', (r->>'events')::int
  from jsonb_array_elements(coalesce(rows->'relay_apps', '[]')) r
  on conflict (bucket, relay, app_key) do update
    set events = relay_app_activity.events + excluded.events;

  insert into apps (app_key, name, website, icon)
  select r->>'app_key', r->>'name', r->>'website', r->>'icon'
  from jsonb_array_elements(coalesce(rows->'app_info', '[]')) r
  on conflict (app_key) do update
    set name = excluded.name,
        website = coalesce(excluded.website, apps.website),
        icon = coalesce(excluded.icon, apps.icon),
        last_seen = now();
$$;

-- Only the worker (service_role) may call it.
revoke execute on function add_activity(jsonb) from public, anon, authenticated;
grant execute on function add_activity(jsonb) to service_role;

-- Page: top apps over the last `minutes` (60 = last hour, 1440 = day, 10080 = week…).
create or replace function top_apps(minutes integer, max_rows integer default 10)
returns table (app_key text, name text, website text, icon text, events bigint)
language sql stable as $$
  select a.app_key, coalesce(i.name, a.app_key), i.website, i.icon, sum(a.events)::bigint
  from app_activity a
  left join apps i on i.app_key = a.app_key
  where a.bucket > now() - make_interval(mins => minutes)
  group by a.app_key, i.name, i.website, i.icon
  order by 5 desc
  limit max_rows;
$$;

-- Page: one app's history, summed per `step_minutes` (e.g. 60 for hourly points).
create or replace function app_history(key text, minutes integer, step_minutes integer default 60)
returns table (bucket timestamptz, events bigint)
language sql stable as $$
  select to_timestamp(floor(extract(epoch from a.bucket) / (step_minutes * 60)) * step_minutes * 60),
         sum(a.events)::bigint
  from app_activity a
  where a.app_key = key and a.bucket > now() - make_interval(mins => minutes)
  group by 1
  order by 1;
$$;

-- Page: top apps by zaps over the last `minutes`. A zap counts for the app that received
-- it or, if it went to a person, for the app it was sent from (see lib/engine.js).
create or replace function top_zapped_apps(minutes integer, max_rows integer default 10)
returns table (app_key text, name text, website text, icon text, zaps bigint, sats bigint)
language sql stable as $$
  select z.app_key, coalesce(i.name, z.app_key), i.website, i.icon,
         sum(z.zaps)::bigint, sum(z.sats)::bigint
  from zap_activity z
  left join apps i on i.app_key = z.app_key
  where z.app_key <> '' and z.bucket > now() - make_interval(mins => minutes)
  group by z.app_key, i.name, i.website, i.icon
  order by 6 desc
  limit max_rows;
$$;

-- Page: all events per category, summed per `step_minutes`, for the pulse history.
create or replace function category_history(minutes integer, step_minutes integer default 60)
returns table (bucket timestamptz, category text, events bigint)
language sql stable as $$
  select to_timestamp(floor(extract(epoch from c.bucket) / (step_minutes * 60)) * step_minutes * 60),
         c.category, sum(c.events)::bigint
  from category_activity c
  where c.bucket > now() - make_interval(mins => minutes)
  group by 1, 2
  order by 1;
$$;

-- Worker heartbeat: a single row, updated after every flush that left nothing unsent, so
-- `updated_at` says how fresh the stored counts are. The page warns when it gets old.
create table if not exists worker_status (
  id integer primary key default 1 check (id = 1),
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  relays integer not null default 0,
  relays_total integer not null default 0
);

alter table worker_status enable row level security;
drop policy if exists "public read" on worker_status;
create policy "public read" on worker_status for select using (true);

create or replace function worker_heartbeat(started timestamptz, relays integer, relays_total integer)
returns void
language sql as $$
  insert into worker_status (id, started_at, updated_at, relays, relays_total)
  values (1, started, now(), relays, relays_total)
  on conflict (id) do update
    set started_at = excluded.started_at, updated_at = now(),
        relays = excluded.relays, relays_total = excluded.relays_total;
$$;

revoke execute on function worker_heartbeat(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function worker_heartbeat(timestamptz, integer, integer) to service_role;

-- Page: the worker's status. `age_seconds` uses the database clock, not the visitor's.
create or replace function radar_status()
returns table (started_at timestamptz, updated_at timestamptz, relays integer,
               relays_total integer, age_seconds integer)
language sql stable as $$
  select started_at, updated_at, relays, relays_total,
         extract(epoch from now() - updated_at)::integer
  from worker_status where id = 1;
$$;

-- Page: trend for the apps shown in a ranking: their count (events or zapped sats) over
-- the last `minutes` vs. the `minutes` before. Only complete buckets count (a bucket is
-- flushed up to ~6 min after it ends), and both periods come back null when the worker
-- missed more than 10% of either, so an outage doesn't read as a drop or a jump.
create or replace function app_trends(minutes integer, keys text[], metric text default 'events')
returns table (app_key text, recent bigint, previous bigint)
language sql stable as $$
  with w as (
    select e, e - make_interval(mins => minutes) as mid, e - make_interval(mins => 2 * minutes) as start
    from (select to_timestamp(floor(extract(epoch from now() - interval '6 minutes') / 600) * 600) as e) b
  ), cov as (
    select count(distinct c.bucket) filter (where c.bucket >= w.mid) as cur,
           count(distinct c.bucket) filter (where c.bucket < w.mid) as prev
    from category_activity c, w
    where c.bucket >= w.start and c.bucket < w.e
  ), counts as (
    select a.app_key, a.bucket, a.events::bigint as n
    from app_activity a where metric = 'events' and a.app_key = any(keys)
    union all
    select z.app_key, z.bucket, z.sats
    from zap_activity z where metric = 'sats' and z.app_key = any(keys)
  )
  select k.key,
         case when ok then coalesce(sum(x.n) filter (where x.bucket >= w.mid), 0) end,
         case when ok then coalesce(sum(x.n) filter (where x.bucket < w.mid), 0) end
  from unnest(keys) k(key)
  cross join w
  cross join (select cur >= 0.9 * minutes / 10 and prev >= 0.9 * minutes / 10 as ok from cov) covered
  left join counts x on x.app_key = k.key and x.bucket >= w.start and x.bucket < w.e
  group by k.key, covered.ok;
$$;

-- Page: apps the worker saw for the first time in the last `minutes`, by activity since.
create or replace function new_apps(minutes integer, max_rows integer default 10)
returns table (app_key text, name text, website text, icon text, events bigint, first_seen timestamptz)
language sql stable as $$
  select i.app_key, i.name, i.website, i.icon, sum(a.events)::bigint, i.first_seen
  from apps i
  join app_activity a on a.app_key = i.app_key and a.bucket >= i.first_seen - interval '10 minutes'
  where i.first_seen > now() - make_interval(mins => minutes)
  group by i.app_key, i.name, i.website, i.icon, i.first_seen
  order by 5 desc
  limit max_rows;
$$;

-- Clients whose events don't count (spam, bots), on top of the built-in lists in
-- lib/bots.js. `pattern` is the normalized name (lowercase, letters and digits only, as
-- normalizeName() gives it); `match` = 'prefix' also blocks every name that starts with it.
-- Edit it with `npm run block` (or the Table Editor); page and worker reload it every 10 min.
create table if not exists blocked_clients (
  pattern text primary key,
  match text not null default 'exact' check (match in ('exact', 'prefix')),
  reason text,
  added_at timestamptz not null default now()
);

alter table blocked_clients enable row level security;
drop policy if exists "public read" on blocked_clients;
create policy "public read" on blocked_clients for select using (true);

-- Page and worker: the blocklist.
create or replace function blocklist()
returns table (pattern text, match text)
language sql stable as $$
  select pattern, match from blocked_clients;
$$;

-- Page: one app's summary for its own page (/app/<name>): display info, events over the
-- last hour / 24 h / 7 days and zaps over 7 days. No rows if the worker never saw it.
create or replace function app_summary(key text)
returns table (app_key text, name text, website text, icon text, first_seen timestamptz,
               hour bigint, day bigint, week bigint, zaps_week bigint, sats_week bigint)
language sql stable as $$
  select i.app_key, i.name, i.website, i.icon, i.first_seen,
         coalesce(sum(a.events) filter (where a.bucket > now() - interval '1 hour'), 0)::bigint,
         coalesce(sum(a.events) filter (where a.bucket > now() - interval '24 hours'), 0)::bigint,
         coalesce(sum(a.events), 0)::bigint,
         (select coalesce(sum(z.zaps), 0)::bigint from zap_activity z
           where z.app_key = key and z.bucket > now() - interval '7 days'),
         (select coalesce(sum(z.sats), 0)::bigint from zap_activity z
           where z.app_key = key and z.bucket > now() - interval '7 days')
  from apps i
  left join app_activity a on a.app_key = i.app_key and a.bucket > now() - interval '7 days'
  where i.app_key = key
  group by i.app_key, i.name, i.website, i.icon, i.first_seen;
$$;

-- Storage: buckets older than `keep_days` are merged into hourly ones (same tables, the
-- bucket is the start of the hour), so the free plan doesn't fill up. 15 days by default:
-- 7-day trends compare against the 7 days before, at 10 minute detail. Running it again
-- is harmless (hourly rows merge into themselves). The worker only writes recent buckets.
create or replace function rollup_old_buckets(keep_days integer default 15)
returns void
language plpgsql as $$
declare
  cutoff timestamptz := date_trunc('hour', now() - make_interval(days => keep_days));
begin
  create temp table rolled_apps on commit drop as
    select date_trunc('hour', bucket) as bucket, app_key, sum(events)::integer as events
    from app_activity where bucket < cutoff group by 1, 2;
  delete from app_activity where bucket < cutoff;
  insert into app_activity select * from rolled_apps;

  create temp table rolled_zaps on commit drop as
    select date_trunc('hour', bucket) as bucket, app_key, sum(zaps)::integer as zaps,
           sum(sats)::bigint as sats
    from zap_activity where bucket < cutoff group by 1, 2;
  delete from zap_activity where bucket < cutoff;
  insert into zap_activity select * from rolled_zaps;

  create temp table rolled_categories on commit drop as
    select date_trunc('hour', bucket) as bucket, category, sum(events)::integer as events
    from category_activity where bucket < cutoff group by 1, 2;
  delete from category_activity where bucket < cutoff;
  insert into category_activity select * from rolled_categories;

  create temp table rolled_platforms on commit drop as
    select date_trunc('hour', bucket) as bucket, app_key, platform, sum(events)::integer as events
    from platform_activity where bucket < cutoff group by 1, 2, 3;
  delete from platform_activity where bucket < cutoff;
  insert into platform_activity select * from rolled_platforms;

  create temp table rolled_relays on commit drop as
    select date_trunc('hour', bucket) as bucket, relay, sum(events)::integer as events,
           sum(fastest)::integer as fastest, sum(solo)::integer as solo, sum(lag_ms)::bigint as lag_ms
    from relay_activity where bucket < cutoff group by 1, 2;
  delete from relay_activity where bucket < cutoff;
  insert into relay_activity (bucket, relay, events, fastest, solo, lag_ms)
    select bucket, relay, events, fastest, solo, lag_ms from rolled_relays;

  create temp table rolled_relay_apps on commit drop as
    select date_trunc('hour', bucket) as bucket, relay, app_key, sum(events)::integer as events
    from relay_app_activity where bucket < cutoff group by 1, 2, 3;
  delete from relay_app_activity where bucket < cutoff;
  insert into relay_app_activity (bucket, relay, app_key, events)
    select bucket, relay, app_key, events from rolled_relay_apps;

  create temp table rolled_authors on commit drop as
    select date_trunc('hour', bucket) as bucket, app_key, author, bool_or(trusted) as trusted
    from app_authors where bucket < cutoff group by 1, 2, 3;
  delete from app_authors where bucket < cutoff;
  insert into app_authors (bucket, app_key, author, trusted)
    select bucket, app_key, author, trusted from rolled_authors;
end;
$$;

revoke execute on function rollup_old_buckets(integer) from public, anon, authenticated;

-- Page: top apps by unique users (distinct trusted authors) over the last `minutes`.
-- Security definer: it reads app_authors, which nobody can read directly; only counts come out.
create or replace function top_apps_by_users(minutes integer, max_rows integer default 10)
returns table (app_key text, name text, website text, icon text, users bigint)
language sql stable security definer set search_path = public as $$
  select u.app_key, coalesce(i.name, u.app_key), i.website, i.icon, count(distinct u.author)
  from app_authors u
  left join apps i on i.app_key = u.app_key
  where u.bucket > now() - make_interval(mins => minutes) and u.trusted
  group by u.app_key, i.name, i.website, i.icon
  order by 5 desc
  limit max_rows;
$$;

-- Page: one app's unique (trusted) users over the last hour / 24 h / 7 days.
create or replace function app_users(key text)
returns table (hour bigint, day bigint, week bigint)
language sql stable security definer set search_path = public as $$
  select count(distinct author) filter (where bucket > now() - interval '1 hour'),
         count(distinct author) filter (where bucket > now() - interval '24 hours'),
         count(distinct author)
  from app_authors
  where app_key = key and bucket > now() - interval '7 days' and trusted;
$$;

-- Page: the apps an app's users also use, over the last `minutes`: for each other app, how
-- many of this app's (trusted) users were seen there too, out of `users` in total. Apps
-- sharing fewer than 3 users are left out, so no row points at a handful of accounts.
create or replace function app_overlap(key text, minutes integer default 10080, max_rows integer default 6)
returns table (app_key text, name text, website text, icon text, shared bigint, users bigint)
language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct author from app_authors
    where app_key = key and trusted and bucket > now() - make_interval(mins => minutes)
  )
  select o.app_key, coalesce(i.name, o.app_key), i.website, i.icon,
         count(distinct o.author), (select count(*) from mine)
  from app_authors o
  join mine m on m.author = o.author
  left join apps i on i.app_key = o.app_key
  where o.app_key <> key and o.trusted and o.bucket > now() - make_interval(mins => minutes)
  group by o.app_key, i.name, i.website, i.icon
  having count(distinct o.author) >= 3
  order by 5 desc
  limit max_rows;
$$;

-- Page: users two apps share over the last `minutes` (for /compare).
create or replace function shared_users(a text, b text, minutes integer default 10080)
returns table (users_a bigint, users_b bigint, shared bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select distinct app_key, author from app_authors
    where app_key in (a, b) and trusted and bucket > now() - make_interval(mins => minutes)
  )
  select count(*) filter (where app_key = a),
         count(*) filter (where app_key = b),
         (select count(*) from (select author from x group by author having count(*) = 2) s)
  from x;
$$;

-- Page: how many of an app's (trusted) users come back. `day_before`: users of the
-- 24 h before the last 24 h; `day_back`: how many of them were seen in the last 24 h.
-- The same for weeks. Only complete buckets: the current one may still be filling.
create or replace function app_retention(key text)
returns table (day_before bigint, day_back bigint, week_before bigint, week_back bigint)
language sql stable security definer set search_path = public as $$
  with w as (
    select to_timestamp(floor(extract(epoch from now() - interval '6 minutes') / 600) * 600) as e
  ), u as (
    select author,
           bool_or(bucket >= w.e - interval '1 day') as d0,
           bool_or(bucket >= w.e - interval '2 days' and bucket < w.e - interval '1 day') as d1,
           bool_or(bucket >= w.e - interval '7 days') as w0,
           bool_or(bucket < w.e - interval '7 days') as w1
    from app_authors, w
    where app_key = key and trusted and bucket >= w.e - interval '14 days' and bucket < w.e
    group by author
  )
  select count(*) filter (where d1), count(*) filter (where d1 and d0),
         count(*) filter (where w1), count(*) filter (where w1 and w0)
  from u;
$$;

-- Page: activity by weekday (0 = Sunday) and hour (UTC) over the last `days`: one app's
-- events, or every event the radar counted when `key` is null.
create or replace function activity_heatmap(key text default null, days integer default 28)
returns table (dow integer, hour integer, events bigint)
language sql stable as $$
  select extract(dow from bucket at time zone 'UTC')::integer,
         extract(hour from bucket at time zone 'UTC')::integer, sum(n)::bigint
  from (
    select a.bucket, a.events as n from app_activity a
    where key is not null and a.app_key = key and a.bucket > now() - make_interval(days => days)
    union all
    select c.bucket, c.events from category_activity c
    where key is null and c.bucket > now() - make_interval(days => days)
  ) x
  group by 1, 2;
$$;

-- Page: one app's events per platform over the last `minutes`, plus its total, so the
-- page can show how much didn't say. The total only counts from the first stored platform
-- bucket: before it the worker didn't record platforms, and it would all read as unstated.
create or replace function app_platforms(key text, minutes integer default 10080)
returns table (platform text, events bigint, total bigint)
language sql stable as $$
  select p.platform, sum(p.events)::bigint,
         (select coalesce(sum(a.events), 0)::bigint from app_activity a
          where a.app_key = key and a.bucket > now() - make_interval(mins => minutes)
            and a.bucket >= (select min(bucket) from platform_activity))
  from platform_activity p
  where p.app_key = key and p.bucket > now() - make_interval(mins => minutes)
  group by p.platform
  order by 2 desc;
$$;


-- Worker: which relays it's connected to, after every heartbeat. rows: [{relay, connected}].
-- `since` moves only when a relay connects or drops.
create or replace function relay_heartbeat(rows jsonb) returns void
language sql as $$
  insert into relay_status (relay, connected, since, updated_at)
  select r->>'relay', (r->>'connected')::boolean, now(), now()
  from jsonb_array_elements(rows) r
  on conflict (relay) do update
    set since = case when relay_status.connected = excluded.connected then relay_status.since
                     else now() end,
        connected = excluded.connected,
        updated_at = now();
$$;

revoke execute on function relay_heartbeat(jsonb) from public, anon, authenticated;
grant execute on function relay_heartbeat(jsonb) to service_role;

-- Page (/relays): each relay over the last `minutes`: counted events it delivered, how many
-- it delivered first and alone, the total delay of its late copies, plus `total`, every
-- counted event in the same buckets (to tell what share of the traffic each one carries),
-- and whether the worker is connected to it now. Relays the worker listens to but that
-- delivered nothing come back with zeros.
create or replace function relay_stats(minutes integer default 1440)
returns table (relay text, events bigint, fastest bigint, solo bigint, lag_ms bigint,
               total bigint, connected boolean, since timestamptz, status_age_seconds integer)
language sql stable as $$
  with r as (
    select ra.relay, sum(ra.events)::bigint as events, sum(ra.fastest)::bigint as fastest,
           sum(ra.solo)::bigint as solo, sum(ra.lag_ms)::bigint as lag_ms
    from relay_activity ra
    where ra.bucket > now() - make_interval(mins => minutes)
    group by ra.relay
  )
  select coalesce(r.relay, s.relay), coalesce(r.events, 0), coalesce(r.fastest, 0),
         coalesce(r.solo, 0), coalesce(r.lag_ms, 0),
         (select coalesce(sum(fastest), 0) from r)::bigint,
         s.connected, s.since, extract(epoch from now() - s.updated_at)::integer
  from r full join relay_status s on s.relay = r.relay
  order by 2 desc;
$$;

-- Page (/relays): for the `max_apps` most active apps over the last `minutes`, how many of
-- their counted events each relay delivered, and `app_total`, the app's counted events
-- since relays were recorded (the share each relay reaches).
create or replace function relay_app_matrix(minutes integer default 1440, max_apps integer default 12)
returns table (relay text, app_key text, name text, website text, icon text, events bigint,
               app_total bigint)
language sql stable as $$
  with w as (
    select greatest(now() - make_interval(mins => minutes),
                    (select min(bucket) from relay_activity)) as t
  ), top as (
    select a.app_key, sum(a.events)::bigint as total
    from app_activity a, w
    where a.bucket >= w.t
    group by a.app_key
    order by 2 desc
    limit max_apps
  )
  select x.relay, t.app_key, coalesce(i.name, t.app_key), i.website, i.icon,
         sum(x.events)::bigint, t.total
  from top t
  join relay_app_activity x on x.app_key = t.app_key
  cross join w
  left join apps i on i.app_key = t.app_key
  where x.bucket >= w.t
  group by x.relay, t.app_key, i.name, i.website, i.icon, t.total;
$$;

-- App flows (/flows): users who left one app and started using another, comparing the
-- last `window_days` with the `window_days` before (complete buckets only). Worked out
-- every 6 hours by refresh_app_flows() and kept here, so the pages read them instantly.
-- from_key = '' means not seen on any app the period before (new to the radar); to_key = ''
-- means not seen on any app since (went quiet). Flows of fewer than 3 users aren't stored.
create table if not exists app_flows (
  from_key text not null,
  to_key text not null,
  users integer not null,
  primary key (from_key, to_key)
);

-- Per app, for the same two periods: users before, users after, and how many stayed.
create table if not exists app_flow_totals (
  app_key text primary key,
  users_before integer not null,
  users_after integer not null,
  users_kept integer not null
);

-- When the flows were worked out, the periods they compare, every user seen in each, and
-- the share of each period's buckets the worker stored (an outage makes a period look emptier).
create table if not exists flows_status (
  id integer primary key default 1 check (id = 1),
  computed_at timestamptz not null,
  window_start timestamptz not null,
  window_mid timestamptz not null,
  window_end timestamptz not null,
  users_before integer not null,
  users_after integer not null,
  users_kept integer not null,
  coverage_before real not null,
  coverage_after real not null
);

alter table app_flows enable row level security;
alter table app_flow_totals enable row level security;
alter table flows_status enable row level security;
drop policy if exists "public read" on app_flows;
drop policy if exists "public read" on app_flow_totals;
drop policy if exists "public read" on flows_status;
create policy "public read" on app_flows for select using (true);
create policy "public read" on app_flow_totals for select using (true);
create policy "public read" on flows_status for select using (true);

-- When the web of trust started: the first bucket with an author it didn't trust. Before it
-- every author row counts as trusted (the column's default), so user counts from then would
-- include accounts it now leaves out. Null if it never ran.
create or replace function trust_since()
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(bucket) from app_authors where not trusted;
$$;

revoke execute on function trust_since() from public, anon, authenticated;

-- A user "moved from A to B" when they used A the period before and not since, and B since
-- and not before. Someone who left A for B and C counts in both flows. Only trusted users.
create or replace function refresh_app_flows(window_days integer default 7)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e timestamptz := to_timestamp(floor(extract(epoch from now() - interval '6 minutes') / 600) * 600);
  mid timestamptz := e - make_interval(days => window_days);
  s timestamptz := e - make_interval(days => 2 * window_days);
  -- Buckets from before the web of trust don't count: they read as missing, so a period
  -- starting before it shows as incomplete.
  ts timestamptz := greatest(s, coalesce(trust_since(), '-infinity'));
begin
  create temp table flow_users on commit drop as
    select app_key, author, bool_or(bucket < mid) as was, bool_or(bucket >= mid) as now_
    from app_authors
    where trusted and bucket >= ts and bucket < e
    group by app_key, author;
  create temp table flow_anyone on commit drop as
    select author, bool_or(was) as was, bool_or(now_) as now_ from flow_users group by author;

  delete from app_flows where true;
  insert into app_flows (from_key, to_key, users)
  select f, t, n from (
    select l.app_key as f, j.app_key as t, count(*)::integer as n
    from flow_users l
    join flow_users j on j.author = l.author and j.app_key <> l.app_key
    where l.was and not l.now_ and j.now_ and not j.was
    group by 1, 2
    union all
    select l.app_key, '', count(*)::integer
    from flow_users l join flow_anyone a on a.author = l.author
    where l.was and not l.now_ and not a.now_
    group by 1
    union all
    select '', j.app_key, count(*)::integer
    from flow_users j join flow_anyone a on a.author = j.author
    where j.now_ and not j.was and not a.was
    group by 2
  ) x
  where n >= 3;

  delete from app_flow_totals where true;
  insert into app_flow_totals (app_key, users_before, users_after, users_kept)
  select app_key, count(*) filter (where was), count(*) filter (where now_),
         count(*) filter (where was and now_)
  from flow_users group by app_key;

  insert into flows_status (id, computed_at, window_start, window_mid, window_end, users_before,
                            users_after, users_kept, coverage_before, coverage_after)
  select 1, now(), s, mid, e,
         (select count(*) filter (where was) from flow_anyone),
         (select count(*) filter (where now_) from flow_anyone),
         (select count(*) filter (where was and now_) from flow_anyone),
         (select count(distinct bucket) filter (where bucket < mid) from category_activity
           where bucket >= ts and bucket < e)::real / (window_days * 144),
         (select count(distinct bucket) filter (where bucket >= mid) from category_activity
           where bucket >= ts and bucket < e)::real / (window_days * 144)
  on conflict (id) do update
    set computed_at = excluded.computed_at, window_start = excluded.window_start,
        window_mid = excluded.window_mid, window_end = excluded.window_end,
        users_before = excluded.users_before, users_after = excluded.users_after,
        users_kept = excluded.users_kept, coverage_before = excluded.coverage_before,
        coverage_after = excluded.coverage_after;
end;
$$;

revoke execute on function refresh_app_flows(integer) from public, anon, authenticated;

-- Page (/flows): the biggest flows between two apps (both known), with their display info.
create or replace function top_flows(max_rows integer default 30)
returns table (from_key text, from_name text, from_icon text, to_key text, to_name text,
               to_icon text, users integer)
language sql stable as $$
  select f.from_key, coalesce(a.name, f.from_key), a.icon,
         f.to_key, coalesce(b.name, f.to_key), b.icon, f.users
  from app_flows f
  left join apps a on a.app_key = f.from_key
  left join apps b on b.app_key = f.to_key
  where f.from_key <> '' and f.to_key <> ''
  order by f.users desc
  limit max_rows;
$$;

-- Page (/flows): per app, users before and after, how many stayed, how many arrived from
-- or left for another app, how many were new to the radar or went quiet. Biggest first.
create or replace function app_flow_summary(max_rows integer default 30)
returns table (app_key text, name text, icon text, users_before integer, users_after integer,
               users_kept integer,
               gained integer, lost integer, arrived_new integer, went_quiet integer)
language sql stable as $$
  select t.app_key, coalesce(i.name, t.app_key), i.icon, t.users_before, t.users_after, t.users_kept,
         coalesce((select sum(users) from app_flows where to_key = t.app_key and from_key <> ''), 0)::integer,
         coalesce((select sum(users) from app_flows where from_key = t.app_key and to_key <> ''), 0)::integer,
         coalesce((select users from app_flows where to_key = t.app_key and from_key = ''), 0),
         coalesce((select users from app_flows where from_key = t.app_key and to_key = ''), 0)
  from app_flow_totals t
  left join apps i on i.app_key = t.app_key
  order by greatest(t.users_before, t.users_after) desc
  limit max_rows;
$$;

-- App page: the apps an app gained users from (direction 'in') and lost users to ('out').
create or replace function app_switches(key text, max_rows integer default 5)
returns table (direction text, app_key text, name text, icon text, users integer)
language sql stable as $$
  (select 'in', f.from_key, coalesce(i.name, f.from_key), i.icon, f.users
   from app_flows f left join apps i on i.app_key = f.from_key
   where f.to_key = key and f.from_key <> ''
   order by f.users desc limit max_rows)
  union all
  (select 'out', f.to_key, coalesce(i.name, f.to_key), i.icon, f.users
   from app_flows f left join apps i on i.app_key = f.to_key
   where f.from_key = key and f.to_key <> ''
   order by f.users desc limit max_rows);
$$;

-- State of Nostr (/state): one row per complete UTC day, worked out after the nightly
-- rollup by refresh_network_daily(). `users`: different trusted accounts seen on any app
-- that day (and over the 7 / 30 days up to it); `events`: every counted event; `apps`:
-- apps with at least 10 events; `coverage`: share of the day's hours the worker stored.
-- The user counts are null when their period starts before the web of trust (trust_since).
create table if not exists network_daily (
  day date primary key,
  users integer not null,
  users_7d integer not null,
  users_30d integer not null,
  events bigint not null,
  zaps integer not null,
  sats bigint not null,
  apps integer not null,
  coverage real not null
);

alter table network_daily alter column users drop not null;
alter table network_daily alter column users_7d drop not null;
alter table network_daily alter column users_30d drop not null;

alter table network_daily enable row level security;
drop policy if exists "public read" on network_daily;
create policy "public read" on network_daily for select using (true);

-- Works out the last `days` complete days (again, if they were already there). Days with
-- nothing counted get no row.
create or replace function refresh_network_daily(days integer default 3)
returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'UTC')::date;
  d date;
  t0 timestamptz;
  t1 timestamptz;
  ts timestamptz := coalesce(trust_since(), '-infinity');
begin
  for d in select generate_series(today - days, today - 1, interval '1 day')::date loop
    t0 := d::timestamp at time zone 'UTC';
    t1 := t0 + interval '1 day';
    -- Days before the radar existed (or with the counter down all day) are left out.
    continue when not exists (select 1 from category_activity where bucket >= t0 and bucket < t1);
    insert into network_daily (day, users, users_7d, users_30d, events, zaps, sats, apps, coverage)
    values (
      d,
      case when t0 >= ts then
        (select count(distinct author) from app_authors where trusted and bucket >= t0 and bucket < t1)
      end,
      case when t1 - interval '7 days' >= ts then
        (select count(distinct author) from app_authors
          where trusted and bucket >= t1 - interval '7 days' and bucket < t1)
      end,
      case when t1 - interval '30 days' >= ts then
        (select count(distinct author) from app_authors
          where trusted and bucket >= t1 - interval '30 days' and bucket < t1)
      end,
      (select coalesce(sum(events), 0) from category_activity where bucket >= t0 and bucket < t1),
      (select coalesce(sum(zaps), 0) from zap_activity where bucket >= t0 and bucket < t1),
      (select coalesce(sum(sats), 0) from zap_activity where bucket >= t0 and bucket < t1),
      (select count(*) from (select app_key from app_activity where bucket >= t0 and bucket < t1
                             group by app_key having sum(events) >= 10) x),
      (select count(distinct date_trunc('hour', bucket)) from category_activity
        where bucket >= t0 and bucket < t1)::real / 24
    )
    on conflict (day) do update
      set users = excluded.users, users_7d = excluded.users_7d, users_30d = excluded.users_30d,
          events = excluded.events, zaps = excluded.zaps, sats = excluded.sats,
          apps = excluded.apps, coverage = excluded.coverage;
  end loop;
end;
$$;

revoke execute on function refresh_network_daily(integer) from public, anon, authenticated;

-- State of Nostr: the last 24 h and the 24 h before, live: users, events, zaps, apps with
-- 10+ events, users over 7 days, and the share of each 24 h the worker stored (trends are
-- only shown when both are nearly complete).
create or replace function network_summary()
returns table (users_day bigint, users_prev bigint, users_week bigint, events_day bigint,
               events_prev bigint, zaps_day bigint, sats_day bigint, sats_prev bigint,
               apps_day bigint, coverage_day real, coverage_prev real)
language sql stable security definer set search_path = public as $$
  with u as (
    select author, bool_or(bucket > now() - interval '24 hours') as d0,
           bool_or(bucket > now() - interval '48 hours' and bucket <= now() - interval '24 hours') as d1
    from app_authors
    where trusted and bucket > now() - interval '48 hours'
    group by author
  )
  select (select count(*) filter (where d0) from u),
         (select count(*) filter (where d1) from u),
         (select count(distinct author) from app_authors
           where trusted and bucket > now() - interval '7 days'),
         (select coalesce(sum(events) filter (where bucket > now() - interval '24 hours'), 0)
           from category_activity where bucket > now() - interval '48 hours')::bigint,
         (select coalesce(sum(events) filter (where bucket <= now() - interval '24 hours'), 0)
           from category_activity where bucket > now() - interval '48 hours')::bigint,
         (select coalesce(sum(zaps), 0) from zap_activity where bucket > now() - interval '24 hours')::bigint,
         (select coalesce(sum(sats) filter (where bucket > now() - interval '24 hours'), 0)
           from zap_activity where bucket > now() - interval '48 hours')::bigint,
         (select coalesce(sum(sats) filter (where bucket <= now() - interval '24 hours'), 0)
           from zap_activity where bucket > now() - interval '48 hours')::bigint,
         (select count(*) from (select app_key from app_activity
            where bucket > now() - interval '24 hours' group by app_key having sum(events) >= 10) x),
         (select count(distinct bucket) filter (where bucket > now() - interval '24 hours')
           from category_activity where bucket > now() - interval '48 hours')::real / 144,
         (select count(distinct bucket) filter (where bucket <= now() - interval '24 hours')
           from category_activity where bucket > now() - interval '48 hours')::real / 144;
$$;

-- Scheduled jobs (pg_cron; scheduling the same name again updates it): the rollup every
-- day at 04:17 UTC, the daily network numbers right after it, the app flows every 6 hours.
create extension if not exists pg_cron;
select cron.schedule('radar-rollup', '17 4 * * *', 'select rollup_old_buckets()');
select cron.schedule('radar-network-daily', '37 4 * * *', 'select refresh_network_daily()');
select cron.schedule('radar-flows', '23 */6 * * *', 'select refresh_app_flows()');

-- First run, so the pages have something before the jobs do: the days the radar already
-- has (up to 60) and the current flows. Harmless to run again; it takes a little while.
select refresh_network_daily(60);
select refresh_app_flows();
