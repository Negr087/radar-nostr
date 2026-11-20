import Link from "next/link";
import Avatar from "@/components/Avatar";
import Sankey from "@/components/Sankey";
import SiteNav from "@/components/SiteNav";
import { duration } from "@/lib/format";
import { loadFlows } from "@/lib/flowsPage";

// Users switching between apps: /flows. The flows are worked out every 6 hours.
export const revalidate = 900;

const num = (n) => n.toLocaleString("en-US");
const day = (t) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const signed = (n) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : "0");

export async function generateMetadata() {
  const data = await loadFlows();
  const title = "App flows · Radar Nostr";
  const top = data?.flows[0];
  const description = top
    ? `Nostr users switching apps this week. Biggest move: ${num(top.users)} went from ${top.from.name} to ${top.to.name}.`
    : "Which Nostr apps people leave and which ones they move to, week over week.";
  return {
    title,
    description,
    openGraph: { title, description, url: "/flows", siteName: "Radar Nostr", type: "website", images: ["/opengraph-image"] },
    twitter: { card: "summary_large_image", title, description },
  };
}

function AppCell({ app }) {
  const body = (
    <>
      <Avatar src={app.pictures} seed={app.key} label={app.name} size={24} rounded="28%" />
      <span className="overlap-name">{app.name}</span>
    </>
  );
  return app.slug ? (
    <Link href={`/app/${app.slug}`} className="flow-app">{body}</Link>
  ) : (
    <span className="flow-app">{body}</span>
  );
}

export default async function FlowsPage() {
  const data = await loadFlows();

  return (
    <main className="app-page wide-page">
      <Link href="/" className="back-link">
        ← Radar Nostr
      </Link>
      <SiteNav active="/flows" />
      <section className="panel app-panel">
        <h1>App flows</h1>
        <p className="page-lede">
          People who stopped using one app and started using another: the last 7 days against
          the 7 days before.
        </p>

        {!data ? (
          <div className="empty">The first flows are still being worked out. Check back in a few hours.</div>
        ) : (
          <>
            <div className="detail-stats app-stats">
              <div title={`${day(data.start)} – ${day(data.mid)}`}>
                <b>{num(data.before)}</b><span>users the week before</span>
              </div>
              <div title={`${day(data.mid)} – ${day(data.end)}`}>
                <b>{num(data.after)}</b><span>users this week</span>
              </div>
              {data.before > 0 && (
                <div title={`${num(data.kept)} of ${num(data.before)}`}>
                  <b>{Math.round((data.kept / data.before) * 100)}%</b><span>came back this week</span>
                </div>
              )}
            </div>

            {!data.complete && (
              <p className="flow-warning" role="note">
                ⚠ The counter was down for part of these two weeks, so some users who stayed
                look like they left or arrived. Read the numbers as rough.
              </p>
            )}

            {data.flows.length > 0 ? (
              <>
                <h3>Who switched to what <small>users, biggest flows · hover a band for its number</small></h3>
                <Sankey flows={data.flows} />

                <h3>Biggest moves</h3>
                <ol className="flow-list">
                  {data.flows.slice(0, 12).map((f) => (
                    <li key={`${f.from.key}>${f.to.key}`}>
                      <AppCell app={f.from} />
                      <span className="flow-arrow" aria-label="to">→</span>
                      <AppCell app={f.to} />
                      <b>{num(f.users)}</b>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="empty">No app had 3 or more users switch to another one this week.</div>
            )}

            {data.apps.length > 0 && (
              <>
                <h3>Per app <small>this week vs. the week before</small></h3>
                <div className="table-scroll">
                  <table className="flow-table">
                    <thead>
                      <tr>
                        <th scope="col">App</th>
                        <th scope="col" title="Users this week minus the week before">Change</th>
                        <th scope="col" title="Users of the week before who came back">Stayed</th>
                        <th scope="col" title="Users who came from another app">From apps</th>
                        <th scope="col" title="Users who moved to another app">To apps</th>
                        <th scope="col" title="Users seen on no app the week before">New</th>
                        <th scope="col" title="Users seen on no app this week">Went quiet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.apps.map((a) => {
                        const net = a.after - a.before;
                        return (
                          <tr key={a.key}>
                            <th scope="row"><AppCell app={a} /></th>
                            <td className={net > 0 ? "up" : net < 0 ? "down" : undefined} title={`${num(a.before)} → ${num(a.after)}`}>
                              {signed(net)}
                            </td>
                            <td>{a.before ? `${Math.round((a.kept / a.before) * 100)}%` : "–"}</td>
                            <td>{a.gained ? `+${num(a.gained)}` : "–"}</td>
                            <td>{a.lost ? `−${num(a.lost)}` : "–"}</td>
                            <td>{a.arrivedNew ? `+${num(a.arrivedNew)}` : "–"}</td>
                            <td>{a.wentQuiet ? `−${num(a.wentQuiet)}` : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className="detail-note">
              A user moved from A to B when they posted with A the week before and not this week,
              and with B this week and not the week before. Someone who left A for both B and C
              counts in both flows. Only accounts the Nostr network follows, stored as anonymous
              ids; flows of fewer than 3 users aren&apos;t shown, so From apps / To apps can add
              up to less than the change. &quot;New&quot; includes accounts the network only started
              following this week. Worked out {duration((Date.now() - Date.parse(data.computedAt)) / 1000)} ago,
              every 6 hours.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
