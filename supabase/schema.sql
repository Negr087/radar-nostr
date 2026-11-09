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

-- For the user overlap and retention functions below.
create index if not exists app_authors_app_bucket on app_authors (app_key, bucket);
create index if not exists app_authors_author on app_authors (author);

-- Worker: adds one flush worth of counts (increments, so several flushes can share a bucket).
-- rows: {"apps":[{bucket,app_key,events}], "zaps":[{bucket,app_key,zaps,sats}],
--        "categories":[{bucket,category,events}], "authors":[{bucket,app_key,author,trusted?}],
--        "platforms":[{bucket,app_key,platform,events}], "app_info":[{app_key,name,website,icon}]}
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
-- page can show how much didn't say.
create or replace function app_platforms(key text, minutes integer default 10080)
returns table (platform text, events bigint, total bigint)
language sql stable as $$
  select p.platform, sum(p.events)::bigint,
         (select coalesce(sum(a.events), 0)::bigint from app_activity a
          where a.app_key = key and a.bucket > now() - make_interval(mins => minutes))
  from platform_activity p
  where p.app_key = key and p.bucket > now() - make_interval(mins => minutes)
  group by p.platform
  order by 2 desc;
$$;

-- Runs the rollup every day at 04:17 UTC (pg_cron; scheduling the same name again updates it).
create extension if not exists pg_cron;
select cron.schedule('radar-rollup', '17 4 * * *', 'select rollup_old_buckets()');
