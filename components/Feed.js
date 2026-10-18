"use client";

import Avatar from "./Avatar";
import { ago, short } from "@/lib/format";
import { CATEGORIES } from "@/lib/kinds";

export default function Feed({ feed, profiles, getApp, filter }) {
  const items = filter ? feed.filter((f) => f.cat === filter) : feed;

  if (!items.length) {
    return <div className="empty">Waiting for activity…</div>;
  }

  return (
    <ul className="feed">
      {items.map((it) => {
        const p = profiles[it.actor] || {};
        const app = getApp(it.appKey);
        const cat = CATEGORIES[it.cat] || CATEGORIES.other;
        const appName = app?.name || it.appName;
        return (
          <li key={it.id} className="feed-item" style={{ "--cat": cat.color }}>
            <a
              href={`https://njump.me/${it.id}`}
              target="_blank"
              rel="noreferrer"
              className="feed-row"
            >
              <Avatar src={p.picture} seed={it.actor} label={p.name} size={34} />
              <div className="feed-body">
                <div className="feed-line">
                  <strong>{p.name || short(it.actor)}</strong> <span>{it.verb}</span>{" "}
                  {appName && (
                    <span className="app-chip">
                      <Avatar
                        src={app?.pictures}
                        seed={it.appKey}
                        label={appName}
                        size={16}
                        rounded="4px"
                      />
                      {it.zapTo ? appName : `via ${appName}`}
                    </span>
                  )}
                  {!appName && it.hint && <span className="hint">{it.hint}?</span>}
                </div>
                {it.preview && <div className="preview">{it.preview}</div>}
              </div>
              <div className="feed-meta">
                <span className="cat-dot" />
                <time>{ago(it.t)}</time>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
