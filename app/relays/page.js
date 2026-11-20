import Link from "next/link";
import Avatar from "@/components/Avatar";
import SiteNav from "@/components/SiteNav";
import { duration } from "@/lib/format";
import { loadRelays } from "@/lib/relaysPage";

// Relay map and health: /relays. Rebuilt at most every 5 minutes.
export const revalidate = 300;

const num = (n) => n.toLocaleString("en-US");
const pct = (n) => (n > 0 && n < 1 ? "<1%" : `${Math.round(n)}%`);
const ms = (n) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);

export const metadata = {
  title: "Relays · Radar Nostr",
  description:
    "Which Nostr relays carry the traffic: share of events, how often each one is first or the only one to have an event, how far behind it runs, and which apps reach it.",
  openGraph: {
    title: "Relays · Radar Nostr",
    description: "Which Nostr relays carry the traffic, how fast they are and which apps reach them.",
    url: "/relays",
    siteName: "Radar Nostr",
    type: "website",
    images: ["/opengraph-image"],
  },
};

function Status({ relay }) {
  const since = relay.since ? duration((Date.now() - Date.parse(relay.since)) / 1000) : null;
  if (relay.status === "up") {
    return <span className="relay-status up" title={since ? `Connected for ${since}` : undefined}>● up</span>;
  }
  if (relay.status === "down") {
    return <span className="relay-status down" title={since ? `Down for ${since}` : undefined}>○ down</span>;
  }
  return <span className="relay-status unknown" title="The counter hasn't reported lately">? unknown</span>;
}

export default async function RelaysPage() {
  const { relays, total, connected, apps, cells } = await loadRelays();
  const busy = relays.filter((r) => r.events > 0);

  return (
    <main className="app-page wide-page">
      <Link href="/" className="back-link">
        ← Radar Nostr
      </Link>
      <SiteNav active="/relays" />
      <section className="panel app-panel">
        <h1>Relays</h1>
        <p className="page-lede">
          The relays the radar listens to, as seen from its counter over the last 24 hours: how
          much of the traffic each one carries, how often it&apos;s the first or the only one to
          deliver an event, and how far behind the fastest one it usually runs.
        </p>

        {!total ? (
          <div className="empty">
            No relay numbers yet: they start with the counter&apos;s next update. Check back in a
            few minutes.
          </div>
        ) : (
          <>
            <div className="detail-stats app-stats">
              <div><b>{connected}/{relays.length}</b><span>connected now</span></div>
              <div><b>{num(total)}</b><span>events · 24 h</span></div>
              <div><b>{busy.length}</b><span>relays with traffic</span></div>
            </div>

            <div className="table-scroll">
              <table className="relay-table">
                <thead>
                  <tr>
                    <th scope="col">Relay</th>
                    <th scope="col">Status</th>
                    <th scope="col" title="Share of every counted event this relay delivered">Has</th>
                    <th scope="col" title="Share of events this relay delivered before any other">First</th>
                    <th scope="col" title="Share of events no other relay delivered">Only here</th>
                    <th scope="col" title="Average delay of the events it delivered after another relay">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {relays.map((r) => (
                    <tr key={r.relay}>
                      <th scope="row" className="relay-host">{r.host}</th>
                      <td><Status relay={r} /></td>
                      <td title={`${num(r.events)} events`}>
                        <span className="cell-bar" aria-hidden="true"><span style={{ width: `${r.share}%` }} /></span>
                        {pct(r.share)}
                      </td>
                      <td>{pct(r.fastest)}</td>
                      <td>{pct(r.solo)}</td>
                      <td>{ms(r.lagMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {apps.length > 0 && (
              <>
                <h3>Where each app&apos;s events show up <small>share of the app&apos;s events each relay had, 24 h</small></h3>
                <div className="table-scroll">
                  <table className="relay-matrix">
                    <thead>
                      <tr>
                        <th scope="col"><span className="sr-only">Relay</span></th>
                        {apps.map((a) => (
                          <th key={a.key} scope="col" title={`${a.name} · ${num(a.total)} events`}>
                            {a.slug ? (
                              <Link href={`/app/${a.slug}`} aria-label={a.name}>
                                <Avatar src={a.pictures} seed={a.key} label={a.name} size={26} rounded="28%" />
                              </Link>
                            ) : (
                              <Avatar src={a.pictures} seed={a.key} label={a.name} size={26} rounded="28%" />
                            )}
                            <span className="matrix-app">{a.name}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {busy.map((r) => (
                        <tr key={r.relay}>
                          <th scope="row" className="relay-host">{r.host}</th>
                          {apps.map((a) => {
                            const v = cells.get(`${r.relay}|${a.key}`) || 0;
                            return (
                              <td
                                key={a.key}
                                className="matrix-cell"
                                title={`${a.name} on ${r.host}: ${pct(v)} of its events`}
                                style={{ "--level": v / 100 }}
                                data-empty={v ? undefined : ""}
                              >
                                {v >= 1 ? Math.round(v) : v > 0 ? "<1" : "·"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        <p className="detail-note">
          Counted events only (bots and spam filtered out), from the relays the radar listens to;
          other relays may carry more. An event usually reaches several relays: &quot;Has&quot;
          adds up to more than 100%, &quot;First&quot; adds up to 100%. Delay is measured
          against the fastest relay, capped at a minute per event, as seen from the counter&apos;s
          own connection.
        </p>
      </section>
    </main>
  );
}
