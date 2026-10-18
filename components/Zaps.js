"use client";

import Avatar from "./Avatar";
import { ago, compactSats, short } from "@/lib/format";

// Visual weight by amount: bigger zaps glow more.
function tier(sats) {
  if (sats >= 10000) return "mega";
  if (sats >= 1000) return "big";
  if (sats >= 100) return "mid";
  return "small";
}

// Zap stream: every zap the relays send, newest on top, flowing in as they arrive
// (like zaplife.lol). The app chip shows when the zap is to or from a known app.
export default function Zaps({ zaps, zapStats, profiles, getApp }) {
  return (
    <div className="zaps">
      <div className="zap-stats">
        <span>
          <b>{zapStats.perMin}</b> zaps/min
        </span>
        <span>
          <b>{zapStats.sats.toLocaleString("en-US")}</b> sats · last 5 min
        </span>
      </div>
      {!zaps.length ? (
        <div className="empty">Waiting for zaps…</div>
      ) : (
        <ul className="zap-list">
          {zaps.map((z) => {
            const from = profiles[z.sender] || {};
            const to = profiles[z.recipient] || {};
            const app = getApp(z.appKey);
            return (
              <li key={z.id} className={`zap ${tier(z.sats)}`}>
                <a
                  href={`https://njump.me/${z.noteId || z.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="zap-row"
                >
                  <Avatar src={from.picture} seed={z.sender} label={from.name} size={30} />
                  <span className="zap-amount">⚡ {compactSats(z.sats)}</span>
                  <Avatar src={to.picture} seed={z.recipient} label={to.name} size={30} />
                  <div className="zap-body">
                    <div className="zap-line">
                      <strong>{from.name || short(z.sender)}</strong>
                      <span> → </span>
                      <strong>{to.name || short(z.recipient)}</strong>
                      {app && (
                        <span className="app-chip">
                          <Avatar
                            src={app.pictures}
                            seed={z.appKey}
                            label={app.name}
                            size={16}
                            rounded="4px"
                          />
                          {z.zapTo ? app.name : `via ${app.name}`}
                        </span>
                      )}
                    </div>
                    {z.comment && <div className="preview">{z.comment}</div>}
                  </div>
                  <time className="zap-time">{ago(z.t)}</time>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
