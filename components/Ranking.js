"use client";

import { useState } from "react";
import Avatar from "./Avatar";

const TABS = [
  { id: "hour", label: "Última hora" },
  { id: "day", label: "24 h" },
];

// Top 10 de apps por actividad. Se cuenta en este navegador mientras la página
// está abierta, así que "24 h" es en realidad "lo que viste en las últimas 24 h".
export default function Ranking({ ranking, onSelect }) {
  const [tab, setTab] = useState("hour");
  const rows = ranking[tab];
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="ranking">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <div className="empty">Juntando datos… el ranking se arma con lo que llega en vivo.</div>
      ) : (
        <ol className="rank-list">
          {rows.map((r, i) => (
            <li key={r.key}>
              <button type="button" className="rank-row" onClick={() => onSelect(r.key)}>
                <span className="rank-pos">{i + 1}</span>
                <Avatar src={r.pictures} seed={r.key} label={r.name} size={24} rounded="6px" />
                <span className="rank-name">{r.name}</span>
                <span className="rank-bar">
                  <span style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="rank-count">{r.count.toLocaleString("es-AR")}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
