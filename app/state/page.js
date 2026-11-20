import Link from "next/link";
import Avatar from "@/components/Avatar";
import Heatmap from "@/components/Heatmap";
import LineChart from "@/components/LineChart";
import SiteNav from "@/components/SiteNav";
import { compactSats } from "@/lib/format";
import { STATE_HEATMAP_DAYS, loadState } from "@/lib/statePage";

// The whole network at a glance: /state. Rebuilt at most every 10 minutes.
export const revalidate = 600;

const ACCENT = "#a78bfa";
const ORANGE = "#f7931a";
const num = (n) => n.toLocaleString("en-US");
const dayLabel = (t) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export async function generateMetadata() {
  const { live } = await loadState();
  const title = "State of Nostr · Radar Nostr";
  const description = live
    ? `Nostr in the last 24 h: ${num(live.users)} active users, ${num(live.events)} events, ` +
      `${compactSats(live.sats)} sats zapped across ${num(live.apps)} apps.`
    : "How big Nostr is and where it's going: active users, events and zaps, day by day.";
  return {
    title,
    description,
    openGraph: { title, description, url: "/state", siteName: "Radar Nostr", type: "website", images: ["/opengraph-image"] },
    twitter: { card: "summary_large_image", title, description },
  };
}

function Trend({ value }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <small className={`trend ${up ? "up" : "down"}`} title="vs. the 24 h before">
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </small>
  );
}

function Tile({ value, label, trend, title }) {
  return (
    <div title={title}>
      <b>
        {value} <Trend value={trend} />
      </b>
      <span>{label}</span>
    </div>
  );
}

export default async function StatePage() {
  const { live, days, month, gaps, categories, top, heat } = await loadState();
  const series = (key, label, color) => [
    { label, color, points: days.map((d) => ({ t: d.t, events: d[key] })) },
  ];

  return (
    <main className="app-page wide-page">
      <Link href="/" className="back-link">
        ← Radar Nostr
      </Link>
      <SiteNav active="/state" />
      <section className="panel app-panel">
        <h1>State of Nostr</h1>
        <p className="page-lede">
          The whole network, not one app: how many people are active, how much they do and how
          much they zap, counted 24/7 from public relays.
        </p>

        {!live ? (
          <div className="empty">The network numbers aren&apos;t available right now. Try again in a few minutes.</div>
        ) : (
          <div className="detail-stats app-stats">
            <Tile value={num(live.users)} label="active users · 24 h" trend={live.trends?.users} />
            <Tile value={num(live.usersWeek)} label="active users · 7 days" />
            {month && (
              <Tile
                value={num(month.users)}
                label="active users · 30 days"
                trend={month.change}
                title="The 30 days up to yesterday, vs. the 30 days before"
              />
            )}
            <Tile value={num(live.events)} label="events · 24 h" trend={live.trends?.events} />
            <Tile
              value={compactSats(live.sats)}
              label="sats zapped · 24 h"
              trend={live.trends?.sats}
              title={`${num(live.sats)} sats in ${num(live.zaps)} zaps`}
            />
            <Tile value={num(live.apps)} label="apps in use · 24 h" title="Apps with 10 or more events" />
          </div>
        )}

        {days.length >= 2 ? (
          <>
            <h3>Active users <small>per day</small></h3>
            <LineChart series={series("users", "Active users", ACCENT)} timeLabel={dayLabel} label="Active users per day" />

            <h3>Events <small>per day</small></h3>
            <LineChart series={series("events", "Events", ACCENT)} timeLabel={dayLabel} label="Events per day" />

            <h3>Sats zapped <small>per day</small></h3>
            <LineChart series={series("sats", "Sats zapped", ORANGE)} timeLabel={dayLabel} label="Sats zapped per day" />

            {gaps.length > 0 && (
              <p className="detail-note">
                The counter was down for part of{" "}
                {gaps.map((d) => `${dayLabel(d.t)} (${Math.round(d.coverage * 100)}% counted)`).join(", ")}:
                those days read lower than they were.
              </p>
            )}
          </>
        ) : (
          <p className="detail-note">Day-by-day charts show up after the radar&apos;s first full days.</p>
        )}

        {categories.length > 0 && (
          <>
            <h3>What people do <small>share of events, 7 days</small></h3>
            <ul className="overlap-list platform-list">
              {categories.map((c) => (
                <li key={c.cat} title={`${num(c.events)} events`}>
                  <div>
                    <span className="overlap-name">
                      <i className="swatch" style={{ background: c.color }} aria-hidden="true" />
                      {c.label}
                    </span>
                    <span className="overlap-bar" aria-hidden="true">
                      <span style={{ width: `${c.share}%`, background: c.color }} />
                    </span>
                    <b>{c.share < 1 ? "<1" : Math.round(c.share)}%</b>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {top.length > 0 && (
          <>
            <h3>Most used apps <small>users, last 24 h</small></h3>
            <ul className="overlap-list">
              {top.map((a) => {
                const peak = top[0].users || 1;
                const body = (
                  <>
                    <Avatar src={a.pictures} seed={a.key} label={a.name} size={28} rounded="28%" />
                    <span className="overlap-name">{a.name}</span>
                    <span className="overlap-bar" aria-hidden="true">
                      <span style={{ width: `${(a.users / peak) * 100}%` }} />
                    </span>
                    <b>{num(a.users)}</b>
                  </>
                );
                return (
                  <li key={a.key}>{a.slug ? <Link href={`/app/${a.slug}`}>{body}</Link> : <div>{body}</div>}</li>
                );
              })}
            </ul>
          </>
        )}

        {heat && (
          <>
            <h3>When Nostr is busiest <small>events by weekday and hour (UTC), last {STATE_HEATMAP_DAYS} days</small></h3>
            <Heatmap grid={heat} />
          </>
        )}

        <p className="detail-note">
          Active users: different accounts the Nostr network follows that posted through an app
          signing a <code>client</code> tag (NIP-89); people only on apps that don&apos;t sign
          aren&apos;t counted, so the real number is higher. Events: everything the radar counts,
          bots filtered out. Day-by-day numbers are worked out every night for complete UTC days.
        </p>
      </section>
    </main>
  );
}
