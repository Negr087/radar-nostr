import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import LineChart from "@/components/LineChart";
import { compactSats } from "@/lib/format";
import { loadChoices, loadCompared, loadShared, pickSlugs } from "@/lib/comparePage";

// Two apps side by side: /compare?a=primal&b=damus. With no apps given, today's top two.

const COLORS = ["#a78bfa", "#f7931a"]; // the accent and the zap orange
const num = (n) => n.toLocaleString("en-US");
const first = (v) => (Array.isArray(v) ? v[0] : v);

// Rows of the side-by-side table. `value(app)`: a number, or null when there isn't one.
// `lower`: smaller wins (rank).
const ROWS = [
  { label: "Rank today", value: (a) => a.rank, show: (n) => `#${n}`, lower: true },
  { label: "Users · 24 h", value: (a) => a.users?.day ?? null },
  { label: "Users · 7 days", value: (a) => a.users?.week ?? null },
  { label: "Events · 1 h", value: (a) => a.hour },
  { label: "Events · 24 h", value: (a) => a.day },
  { label: "Events · 7 days", value: (a) => a.week },
  { label: "Sats zapped · 7 days", value: (a) => a.satsWeek, show: compactSats },
  { label: "Zaps · 7 days", value: (a) => a.zapsWeek },
];

async function load(searchParams) {
  const params = await searchParams;
  const choices = await loadChoices();
  const [slugA, slugB] = pickSlugs(first(params.a), first(params.b), choices);
  const [a, b] = await Promise.all([loadCompared(slugA), loadCompared(slugB)]);
  return { params, choices, slugA, slugB, a, b, shared: await loadShared(a, b) };
}

export async function generateMetadata({ searchParams }) {
  const { a, b } = await load(searchParams);
  if (!a || !b) return { title: "Compare apps · Radar Nostr" };
  const title = `${a.name} vs ${b.name} · Radar Nostr`;
  const users = a.users && b.users ? ` · users: ${num(a.users.day)} vs ${num(b.users.day)}` : "";
  const description = `${a.name} vs ${b.name} on Nostr, last 24 h: events ${num(a.day)} vs ${num(b.day)}${users}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/compare?a=${a.slug}&b=${b.slug}`,
      siteName: "Radar Nostr",
      type: "website",
      images: ["/opengraph-image"],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function Picker({ name, value, label }) {
  return (
    <label className="compare-pick">
      <span>{label}</span>
      <input
        name={name}
        defaultValue={value || ""}
        list="compare-apps"
        placeholder="App name"
        autoComplete="off"
        spellCheck="false"
      />
    </label>
  );
}

function Head({ app, color }) {
  return (
    <Link href={`/app/${app.slug}`} className="compare-app" style={{ "--side": color }}>
      <Avatar src={app.pictures} seed={app.key} label={app.name} size={48} rounded="28%" />
      <span>{app.name}</span>
    </Link>
  );
}

function Row({ row, a, b }) {
  const va = row.value(a);
  const vb = row.value(b);
  const show = (v) => (v == null ? "–" : row.show ? row.show(v) : num(v));
  const both = va != null && vb != null;
  const aWins = both && va !== vb && (row.lower ? va < vb : va > vb);
  const bWins = both && va !== vb && !aWins;
  // Share bar: how the two split the total (not for ranks).
  const total = both && !row.lower ? va + vb : 0;
  return (
    <div className="compare-row">
      <b className={aWins ? "win a" : ""}>{show(va)}</b>
      <div className="compare-label">
        <span>{row.label}</span>
        {total > 0 && (
          <div className="compare-share" aria-hidden="true">
            <i style={{ width: `${(va / total) * 100}%`, background: COLORS[0] }} />
            <i style={{ width: `${(vb / total) * 100}%`, background: COLORS[1] }} />
          </div>
        )}
      </div>
      <b className={bWins ? "win b" : ""}>{show(vb)}</b>
    </div>
  );
}

const hourLabel = (t) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
const dayLabel = (t) => {
  const d = new Date(t);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${d.toISOString().slice(11, 13)}h`;
};

export default async function ComparePage({ searchParams }) {
  const { params, choices, slugA, slugB, a, b, shared } = await load(searchParams);
  // One address per pair: ?a=Primal%20Android -> ?a=primal
  const asked = [first(params.a), first(params.b)];
  if (asked.every(Boolean) && (asked[0] !== slugA || asked[1] !== slugB)) {
    redirect(`/compare?a=${encodeURIComponent(slugA)}&b=${encodeURIComponent(slugB)}`);
  }
  const series = (key) =>
    [a, b].map((app, i) => ({ label: app.name, color: COLORS[i], points: app[key] }));

  return (
    <main className="app-page compare-page">
      <Link href="/" className="back-link">
        ← Radar Nostr
      </Link>
      <section className="panel app-panel">
        <h1>Compare apps</h1>
        <form className="compare-form" action="/compare">
          <Picker name="a" label="App" value={slugA} />
          <span className="compare-vs">vs</span>
          <Picker name="b" label="App" value={slugB} />
          <button type="submit" className="app-button">Compare</button>
          <datalist id="compare-apps">
            {choices.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </datalist>
        </form>

        {!a || !b ? (
          <div className="empty">
            {[
              [slugA, a],
              [slugB, b],
            ]
              .filter(([slug, app]) => slug && !app)
              .map(([slug]) => `“${slug}” isn't on the radar.`)
              .join(" ") || "Pick two apps to compare."}{" "}
            Try one of today&apos;s most active apps from the list.
          </div>
        ) : (
          <>
            <div className="compare-heads">
              <Head app={a} color={COLORS[0]} />
              <Link
                href={`/compare?a=${b.slug}&b=${a.slug}`}
                className="compare-swap"
                title="Swap sides"
                aria-label="Swap sides"
              >
                ⇄
              </Link>
              <Head app={b} color={COLORS[1]} />
            </div>

            <div className="compare-table">
              {ROWS.map((row) => (
                <Row key={row.label} row={row} a={a} b={b} />
              ))}
            </div>

            {shared && (
              <p className="compare-shared">
                <b>{num(shared.shared)}</b> users used both in the last 7 days:{" "}
                <span style={{ color: COLORS[0] }}>{shared.ofA}% of {a.name}&apos;s</span> and{" "}
                <span style={{ color: COLORS[1] }}>{shared.ofB}% of {b.name}&apos;s</span>.
              </p>
            )}

            <h3>Last 24 hours <small>events per hour</small></h3>
            <LineChart series={series("points")} timeLabel={hourLabel} label="Events per hour, last 24 hours" />

            <h3>Last 7 days <small>events every 6 hours</small></h3>
            <LineChart series={series("weekPoints")} timeLabel={dayLabel} label="Events every 6 hours, last 7 days" />

            <p className="detail-note">
              Events signed with each app&apos;s <code>client</code> tag (NIP-89), counted 24/7
              from public relays, bots filtered out. Users: different accounts followed by the
              Nostr network. Zaps count for the app that received them or the one they were
              sent from.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
