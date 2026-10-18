"use client";

import { useState } from "react";
import Avatar from "./Avatar";

const TABS = [
  { id: "hour", label: "Last hour" },
  { id: "day", label: "24 h" },
  { id: "week", label: "7 days" },
];

// Top 10 apps by activity, counted 24/7 by the worker (the same for every visitor).
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
        <div className="empty">
          {!ranking.loaded
            ? "Loading…"
            : ranking.error
              ? "The ranking isn't available right now."
              : "No activity counted in this period yet."}
        </div>
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
                <span className="rank-count">{r.count.toLocaleString("en-US")}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
