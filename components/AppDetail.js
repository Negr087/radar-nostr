"use client";

import { useEffect } from "react";
import Avatar from "./Avatar";
import Feed from "./Feed";

// Panel lateral (abajo en celular) con el detalle de una app: actividad y últimos eventos.
export default function AppDetail({ appKey, apps, getApp, getRecent, getCounts, profiles, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const app = getApp(appKey);
  const live = apps.find((a) => a.key === appKey)?.count || 0;
  const { hour, day } = getCounts(appKey);

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
          <button type="button" className="detail-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <div className="detail-stats">
          <div><b>{live}</b><span>últimos 5 min</span></div>
          <div><b>{hour}</b><span>última hora</span></div>
          <div><b>{day}</b><span>24 h</span></div>
        </div>
        <h3>Últimos eventos</h3>
        <Feed feed={getRecent(appKey)} profiles={profiles} getApp={getApp} />
      </aside>
    </div>
  );
}
