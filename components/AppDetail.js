"use client";

import { useEffect } from "react";
import Avatar from "./Avatar";
import Feed from "./Feed";
import { useAppHistory } from "@/lib/useHistory";

// Side panel (bottom sheet on mobile) with an app's details: live and stored activity,
// a 24 h chart and its latest events. `fallback`: stored info for apps this browser
// hasn't seen live yet (opened from the ranking).
export default function AppDetail({ appKey, apps, getApp, getRecent, fallback, profiles, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const local = getApp(appKey);
  const app = local.name === "Unnamed app" && fallback ? fallback : local;
  const live = apps.find((a) => a.key === appKey)?.count || 0;
  const history = useAppHistory(appKey);
  const stat = (n) => (history && !history.error ? n.toLocaleString("en-US") : "–");
  const recent = getRecent(appKey);
  const peak = Math.max(1, ...(history?.points || []).map((p) => p.events));

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <aside
        className="detail"
        role="dialog"
        aria-label={app.name}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="detail-head">
          <Avatar src={app.pictures} seed={appKey} label={app.name} size={56} rounded="28%" />
          <div className="detail-title">
            <h2>{app.name}</h2>
            {app.website && (
              <a href={app.website} target="_blank" rel="noreferrer">
                {app.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
              </a>
            )}
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="detail-stats">
          <div><b>{live}</b><span>last 5 min</span></div>
          <div><b>{stat(history?.hour)}</b><span>last hour</span></div>
          <div><b>{stat(history?.day)}</b><span>24 h</span></div>
          <div><b>{stat(history?.week)}</b><span>7 days</span></div>
        </div>
        <p className="detail-note">
          Live: what this page saw. Hour, day and week: counted 24/7, about 6 minutes behind.
        </p>
        <h3>Last 24 hours</h3>
        <div className="detail-chart" aria-label="Events per hour, last 24 hours">
          {(history?.points || []).map((p) => (
            <div
              key={p.t}
              className="detail-bar"
              title={`${new Date(p.t).toLocaleTimeString("en-US", { hour: "numeric" })} · ${p.events} events`}
            >
              <span style={{ height: `${(p.events / peak) * 100}%` }} />
            </div>
          ))}
        </div>
        <h3>Latest events</h3>
        {recent.length ? (
          <Feed feed={recent} profiles={profiles} getApp={getApp} />
        ) : (
          <div className="empty">No live events from this app since you opened the page.</div>
        )}
      </aside>
    </div>
  );
}
