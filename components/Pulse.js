"use client";

import { CATEGORIES } from "@/lib/kinds";

// Stacked bars by category, one column per minute (last 30 min).
export default function Pulse({ pulse, filter, onFilter }) {
  const max = Math.max(1, ...pulse.map((p) => p.total));
  const totals = {};
  for (const p of pulse) for (const [c, n] of Object.entries(p.byCat)) totals[c] = (totals[c] || 0) + n;

  return (
    <div className="pulse">
      <div className="pulse-bars">
        {pulse.map((p) => (
          <div key={p.minute} className="pulse-col" title={`${new Date(p.minute).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · ${p.total} events`}>
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
      <div className="legend">
        {Object.entries(CATEGORIES).map(([k, c]) => (
          <button
            key={k}
            className={`legend-item ${filter === k ? "active" : ""}`}
            onClick={() => onFilter(filter === k ? null : k)}
          >
            <span style={{ background: c.color }} />
            {c.label}
            <em>{totals[k] || 0}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
