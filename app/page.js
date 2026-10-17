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
          <span className="tag">qué apps se están usando, ahora</span>
        </div>
        <div className="stats">
          <div><b>{stats.relays}</b><span>relays</span></div>
          <div><b>{stats.total.toLocaleString("es-AR")}</b><span>eventos</span></div>
          <div><b>{apps.length}</b><span>apps activas</span></div>
          <div><b>{pct}%</b><span>firmados</span></div>
          <div><b>{stats.newApps}</b><span>apps nuevas</span></div>
          <div><b>{stats.bots.toLocaleString("es-AR")}</b><span>bots filtrados</span></div>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Apps activas <small>últimos 5 min · tocá una para ver el detalle</small></h2>
          <Bubbles apps={apps} selected={selected} onSelect={setSelected} />
        </div>
        <div className="panel feed-panel">
          <h2>
            En vivo {filter && <button className="clear" onClick={() => setFilter(null)}>× quitar filtro</button>}
          </h2>
          <Feed feed={feed} profiles={profiles} getApp={getApp} filter={filter} />
        </div>
      </section>

      <section className="grid grid-bottom">
        <div className="panel">
          <h2>Ranking <small>contado en este navegador</small></h2>
          <Ranking ranking={ranking} onSelect={setSelected} />
        </div>
        <div className="panel">
          <h2>Pulso <small>eventos por minuto · tocá una categoría para filtrar</small></h2>
          <Pulse pulse={pulse} filter={filter} onFilter={setFilter} />
        </div>
      </section>

      <footer>
        Solo se atribuyen a una app los eventos con tag <code>client</code> (NIP-89). El resto se
        clasifica por tipo de evento. Hecho con NDK.
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
