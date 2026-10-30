"use client";

import { useCallback, useState } from "react";
import { duration } from "@/lib/format";
import { useRanking, useWorkerStatus } from "@/lib/useHistory";
import { useRadar } from "@/lib/useRadar";
import AppDetail from "@/components/AppDetail";
import Bubbles from "@/components/Bubbles";
import Feed from "@/components/Feed";
import Pulse from "@/components/Pulse";
import Ranking from "@/components/Ranking";
import Zaps from "@/components/Zaps";

export default function Home() {
  const {
    feed,
    apps,
    pulse,
    stats,
    profiles,
    zaps,
    zapStats,
    getApp,
    getRecent,
  } = useRadar();
  const ranking = useRanking(getApp);
  const worker = useWorkerStatus();
  // Hover list of relays and whether each one is connected.
  const relayTitle = stats.relayList
    .map((r) => `${r.up ? "●" : "○"} ${r.url.replace("wss://", "")}`)
    .join("\n");
  const [filter, setFilter] = useState(null);
  const [selected, setSelected] = useState(null);
  // Stored info for an app opened from the ranking that this browser hasn't seen live.
  const rankedInfo = ["events", "sats"]
    .flatMap((m) => ["hour", "day", "week"].flatMap((w) => ranking[m][w]))
    .find((r) => r.key === selected);
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
          <div title={relayTitle}>
            <b>{stats.relays}/{stats.relayList.length}</b><span>relays</span>
          </div>
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
          <h2>
            Ranking{" "}
            {worker?.stale ? (
              <small className="stale" title="The stored counts aren't being updated: the ranking and history may be out of date.">
                ⚠ counter offline · last update {duration(worker.age)} ago
              </small>
            ) : (
              <small>
                counted 24/7{worker && !worker.error && ` · updated ${duration(worker.age)} ago`}
              </small>
            )}
          </h2>
          <Ranking ranking={ranking} onSelect={setSelected} />
        </div>
        <div className="panel">
          <h2>Zaps <small>every zap, live</small></h2>
          <Zaps zaps={zaps} zapStats={zapStats} profiles={profiles} getApp={getApp} />
        </div>
      </section>

      <section className="panel">
        <h2>Pulse <small>events by category · tap one to filter the live feed</small></h2>
        <Pulse pulse={pulse} filter={filter} onFilter={setFilter} />
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
          fallback={rankedInfo}
          profiles={profiles}
          onClose={closeDetail}
        />
      )}
    </main>
  );
}
