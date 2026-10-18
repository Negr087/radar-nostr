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

-- Worker: adds one flush worth of counts (increments, so several flushes can share a bucket).
-- rows: {"apps":[{bucket,app_key,events}], "zaps":[{bucket,app_key,zaps,sats}],
--        "categories":[{bucket,category,events}], "app_info":[{app_key,name,website,icon}]}
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
