"use client";

import { useState } from "react";
import Avatar from "./Avatar";
import { compactSats, duration } from "@/lib/format";

const TABS = [
  { id: "hour", label: "Last hour", previous: "the hour before" },
  { id: "day", label: "24 h", previous: "the 24 h before" },
  { id: "week", label: "7 days", previous: "the 7 days before" },
];

const METRICS = [
  { id: "events", label: "Events" },
  { id: "sats", label: "⚡ Sats" },
  { id: "new", label: "✨ New" },
];

// Smaller changes than this (in %) aren't shown: they're the usual ups and downs.
const TREND_SHOWN = 20;

// Trend vs. the previous period ("↑ 35%"), or how long ago a new app was first seen.
function Trend({ row, metric, tab }) {
  if (metric === "new") {
    return (
      <span className="rank-trend" title="First seen by the radar">
        {duration((Date.now() - row.firstSeen) / 1000)}
      </span>
    );
  }
  if (row.trend == null || Math.abs(row.trend) < TREND_SHOWN) return <span className="rank-trend" />;
  const up = row.trend > 0;
  const previous = TABS.find((t) => t.id === tab).previous;
  return (
    <span className={`rank-trend ${up ? "up" : "down"}`} title={`vs. ${previous}`}>
      {up ? "↑" : "↓"} {Math.abs(row.trend) > 999 ? ">999" : Math.abs(row.trend)}%
    </span>
  );
}

// Top 10 apps by activity or by zapped sats, plus the apps first seen in the period,
// counted 24/7 by the worker (the same for every visitor).
export default function Ranking({ ranking, onSelect }) {
  const [tab, setTab] = useState("hour");
  const [metric, setMetric] = useState("events");
  const rows = ranking[metric][tab];
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="ranking">
      <div className="ranking-controls">
        <div className="tabs" role="tablist" aria-label="Period">
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
        <div className="tabs" role="tablist" aria-label="Ranked by">
          {METRICS.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={metric === m.id}
              className={`tab ${metric === m.id ? "active" : ""}`}
              onClick={() => setMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <div className="empty">
          {!ranking.loaded
            ? "Loading…"
            : ranking.error[metric]
              ? "The ranking isn't available right now."
              : metric === "sats"
                ? "No zaps through an app counted in this period yet."
                : metric === "new"
                  ? "No new apps in this period."
                  : "No activity counted in this period yet."}
        </div>
      ) : (
        <ol className={`rank-list ${metric}`}>
          {rows.map((r, i) => (
            <li key={r.key}>
              <button
                type="button"
                className="rank-row"
                onClick={() => onSelect(r.key)}
                title={
                  metric === "sats"
                    ? `${r.count.toLocaleString("en-US")} sats in ${r.zaps.toLocaleString("en-US")} zaps`
                    : undefined
                }
              >
                <span className="rank-pos">{i + 1}</span>
                <Avatar src={r.pictures} seed={r.key} label={r.name} size={24} rounded="6px" />
                <span className="rank-name">{r.name}</span>
                <span className="rank-bar">
                  <span style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="rank-count">
                  {metric === "sats" ? compactSats(r.count) : r.count.toLocaleString("en-US")}
                </span>
                <Trend row={r} metric={metric} tab={tab} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {metric === "sats" && rows.length > 0 && (
        <p className="rank-note">
          Zaps to an app count for it; zaps to a person count for the app they were sent from.
        </p>
      )}
      {metric === "new" && rows.length > 0 && (
        <p className="rank-note">
          Apps the radar saw for the first time in this period, by events since then.
        </p>
      )}
    </div>
  );
}
