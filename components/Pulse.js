"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/kinds";
import { useCategoryHistory } from "@/lib/useHistory";

const TABS = [
  { id: "live", label: "Live 30 min" },
  { id: "day", label: "24 h" },
  { id: "week", label: "7 days" },
];

// Column tooltip time: minutes for the live view, hours for 24 h, day + hour for 7 days.
const TIME_FORMAT = {
  live: { hour: "2-digit", minute: "2-digit" },
  day: { hour: "2-digit", minute: "2-digit" },
  week: { weekday: "short", hour: "2-digit", minute: "2-digit" },
};

// Stacked bars by category: one column per minute live (from this browser), or the stored
// history (from the worker) for the last 24 h / 7 days.
export default function Pulse({ pulse, filter, onFilter }) {
  const [tab, setTab] = useState("live");
  const history = useCategoryHistory(tab);
  const columns = tab === "live" ? pulse : Array.isArray(history) ? history : [];
  const max = Math.max(1, ...columns.map((p) => p.total));
  const totals = {};
  for (const p of columns) for (const [c, n] of Object.entries(p.byCat)) totals[c] = (totals[c] || 0) + n;
  const message =
    tab === "live" ? null : history?.error ? "The history isn't available right now." : !history ? "Loading…" : null;

  return (
    <div className="pulse">
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
      {message ? (
        <div className="pulse-bars pulse-message">{message}</div>
      ) : (
        <div className="pulse-bars">
          {columns.map((p) => (
            <div key={p.minute} className="pulse-col" title={`${new Date(p.minute).toLocaleString("en-US", TIME_FORMAT[tab])} · ${p.total.toLocaleString("en-US")} events`}>
              {Object.keys(CATEGORIES).map((c) =>
                p.byCat[c] ? (
                  <div
                    key={c}
                    style={{
                      height: `${(p.byCat[c] / max) * 100}%`,
                      background: CATEGORIES[c].color,
                      opacity: filter && filter !== c ? 0.15 : 1,
                    }}
                  />
                ) : null
              )}
            </div>
          ))}
        </div>
      )}
      <div className="legend">
        {Object.entries(CATEGORIES).map(([k, c]) => (
          <button
            key={k}
            className={`legend-item ${filter === k ? "active" : ""}`}
            onClick={() => onFilter(filter === k ? null : k)}
          >
            <span style={{ background: c.color }} />
            {c.label}
            <em>{(totals[k] || 0).toLocaleString("en-US")}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
