import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import { loadAppPage } from "@/lib/appPage";
import { compactSats } from "@/lib/format";
import { normalizeName } from "@/lib/knownApps";

// Counts are stored every minute; the page is rebuilt at most every 5 minutes.
export const revalidate = 300;

const num = (n) => n.toLocaleString("en-US");

// One line for search results and link previews.
function describe(app) {
  const parts = [
    app.users
      ? `${num(app.users.day)} users and ${num(app.day)} events in the last 24 h`
      : `${num(app.day)} events in the last 24 h`,
  ];
  if (app.rank) parts.push(`#${app.rank} on Nostr today`);
  if (app.satsWeek) parts.push(`${compactSats(app.satsWeek)} sats zapped in 7 days`);
  return `${app.name} on Radar Nostr: ${parts.join(" · ")}.`;
}

export async function generateMetadata({ params }) {
  const { name } = await params;
  const app = await loadAppPage(name);
  if (!app) return { title: "App not found · Radar Nostr" };
  const title = `${app.name} · Radar Nostr`;
  const description = describe(app);
  // The share image comes from ./opengraph-image.js (Next links it automatically).
  return {
    title,
    description,
    openGraph: { title, description, url: `/app/${app.slug}`, siteName: "Radar Nostr", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AppPage({ params }) {
  const { name } = await params;
  // One address per app: /app/Primal-Android -> /app/primal
  const slug = normalizeName(decodeURIComponent(name));
  if (slug && slug !== name) redirect(`/app/${slug}`);
  const app = await loadAppPage(name);
  if (!app) notFound();

  const peak = Math.max(1, ...app.points.map((p) => p.events));
  const since = new Date(app.firstSeen).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="app-page">
      <Link href="/" className="back-link">
        ← Radar Nostr
      </Link>
      <section className="panel app-panel">
        <header className="detail-head">
          <Avatar src={app.pictures} seed={app.key} label={app.name} size={64} rounded="28%" />
          <div className="detail-title">
            <h1>{app.name}</h1>
            {app.website && (
              <a href={app.website} target="_blank" rel="noreferrer">
                {app.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            )}
          </div>
          {app.rank && <div className="app-rank">#{app.rank}<span>today</span></div>}
        </header>

        <div className="detail-stats app-stats">
          {app.users && (
            <>
              <div><b>{num(app.users.day)}</b><span>users · 24 h</span></div>
              <div><b>{num(app.users.week)}</b><span>users · 7 days</span></div>
            </>
          )}
          <div title={`${num(app.satsWeek)} sats in ${num(app.zapsWeek)} zaps`}>
            <b>{compactSats(app.satsWeek)}</b><span>sats · 7 days</span>
          </div>
          <div><b>{num(app.hour)}</b><span>events · 1 h</span></div>
          <div><b>{num(app.day)}</b><span>events · 24 h</span></div>
          <div><b>{num(app.week)}</b><span>events · 7 days</span></div>
        </div>

        <h3>Last 24 hours <small>events per hour</small></h3>
        <div className="detail-chart app-chart" aria-label="Events per hour, last 24 hours">
          {app.points.map((p) => (
            <div
              key={p.t}
              className="detail-bar"
              title={`${new Date(p.t).toISOString().slice(11, 16)} UTC · ${num(p.events)} events`}
            >
              <span style={{ height: `${(p.events / peak) * 100}%` }} />
            </div>
          ))}
        </div>

        <div className="app-actions">
          <Link href={`/?app=${app.slug}`} className="app-button">
            Watch it live on the radar →
          </Link>
          <Link href={`/compare?a=${app.slug}`} className="app-button secondary">
            Compare with another app
          </Link>
        </div>

        <p className="detail-note">
          Events signed with a <code>{app.name}</code> client tag (NIP-89), counted 24/7 from
          public relays, bots filtered out. Users: different accounts behind those events that the
          Nostr network follows. On the radar since {since}. Updated every few
          minutes.
        </p>
      </section>
    </main>
  );
}
