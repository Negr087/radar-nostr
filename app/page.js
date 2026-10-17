"use client";

import { useCallback, useState } from "react";
import { useRadar } from "@/lib/useRadar";
import AppDetail from "@/components/AppDetail";
import Bubbles from "@/components/Bubbles";
import Feed from "@/components/Feed";
import Pulse from "@/components/Pulse";
import Ranking from "@/components/Ranking";

export default function Home() {
  const { feed, apps, pulse, stats, profiles, ranking, getApp, getRecent, getCounts } =
    useRadar();
  const [filter, setFilter] = useState(null);
  const [selected, setSelected] = useState(null);
  const closeDetail = useCallback(() => setSelected(null), []);
  const pct = stats.total ? Math.round((stats.tagged / stats.total) * 100) : 0;

  return (
    <main>
      <header className="top">
        <div className="brand">
          <span className="live-dot" />
          <h1>Radar Nostr</h1>
          <span className="tag">which apps people are using, right now</span>
        </div>
        <div className="stats">
          <div><b>{stats.relays}</b><span>relays</span></div>
          <div><b>{stats.total.toLocaleString("en-US")}</b><span>events</span></div>
          <div><b>{apps.length}</b><span>active apps</span></div>
          <div><b>{pct}%</b><span>signed</span></div>
          <div><b>{stats.newApps}</b><span>new apps</span></div>
          <div><b>{stats.bots.toLocaleString("en-US")}</b><span>bots filtered</span></div>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Active apps <small>last 5 min · tap one for details</small></h2>
          <Bubbles apps={apps} selected={selected} onSelect={setSelected} />
        </div>
        <div className="panel feed-panel">
          <h2>
            Live {filter && <button className="clear" onClick={() => setFilter(null)}>× clear filter</button>}
          </h2>
          <Feed feed={feed} profiles={profiles} getApp={getApp} filter={filter} />
        </div>
      </section>

      <section className="grid grid-bottom">
        <div className="panel">
          <h2>Ranking <small>counted in this browser</small></h2>
          <Ranking ranking={ranking} onSelect={setSelected} />
        </div>
        <div className="panel">
          <h2>Pulse <small>events per minute · tap a category to filter</small></h2>
          <Pulse pulse={pulse} filter={filter} onFilter={setFilter} />
        </div>
      </section>

      <footer>
        Only events with a <code>client</code> tag (NIP-89) are attributed to an app. The rest are
        classified by event kind. Built with NDK.
      </footer>

      {selected && (
        <AppDetail
          appKey={selected}
          apps={apps}
          getApp={getApp}
          getRecent={getRecent}
          getCounts={getCounts}
          profiles={profiles}
          onClose={closeDetail}
        />
      )}
    </main>
  );
}
