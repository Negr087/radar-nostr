"use client";

import { useEffect, useRef, useState } from "react";
import Bubbles from "./Bubbles";
import Ranking from "./Ranking";
import Zaps from "./Zaps";

// Kiosk / TV mode (/?tv): full screen, one view at a time, rotating on its own.
//   /?tv          every view, 20 s each
//   /?tv=45       every view, 45 s each
//   /?tv=zaps     just that view (bubbles, ranking or zaps)
// Remote / keyboard: ← → change view, OK / Enter / space pauses, F goes full screen.

export const TV_VIEWS = [
  { id: "bubbles", title: "Active apps", sub: "last 5 min · bigger = more activity" },
  { id: "ranking", title: "Top apps", sub: "last 24 h · counted 24/7" },
  { id: "zaps", title: "Zaps", sub: "every zap, live" },
];
const DEFAULT_SECONDS = 20;
const MIN_SECONDS = 5;
const IDLE_MS = 3000; // the cursor and the exit link hide after this

// The `tv` query value -> {seconds, only} (`only`: a single view, no rotation).
export function parseTv(value) {
  const only = TV_VIEWS.find((v) => v.id === value)?.id || null;
  const n = Number(value);
  const seconds = !only && n > 0 ? Math.max(MIN_SECONDS, Math.round(n)) : DEFAULT_SECONDS;
  return { seconds, only };
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="tv-clock">
      {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

// Keeps the screen on while the page is visible (where the browser supports it).
function useWakeLock() {
  useEffect(() => {
    if (!navigator.wakeLock) return;
    let lock = null;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      if (lock) lock.release().catch(() => {});
    };
  }, []);
}

function toggleFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    const result = active ? exit.call(document) : request.call(el);
    if (result && result.catch) result.catch(() => {});
  } catch {}
}

export default function TvMode({ tv, apps, ranking, zaps, zapStats, profiles, getApp, stats, worker }) {
  const views = tv.only ? TV_VIEWS.filter((v) => v.id === tv.only) : TV_VIEWS;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(null);
  const view = views[index % views.length];
  const rotating = views.length > 1 && !paused;

  useWakeLock();

  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % views.length), tv.seconds * 1000);
    return () => clearTimeout(timer);
  }, [index, rotating, views.length, tv.seconds]);

  useEffect(() => {
    const wake = () => {
      setIdle(false);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const onKey = (e) => {
      wake();
      const step = (d) => setIndex((i) => (i + d + views.length) % views.length);
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "MediaTrackNext") step(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "MediaTrackPrevious") step(-1);
      else if (e.key === "Enter" || e.key === " " || e.key === "MediaPlayPause") setPaused((p) => !p);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else return;
      e.preventDefault();
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", onKey);
    };
  }, [views.length]);

  return (
    <div className={`tv ${idle ? "tv-idle" : ""}`} onDoubleClick={toggleFullscreen}>
      <header className="tv-top">
        <div className="brand">
          <span className="live-dot" />
          <h1>Radar Nostr</h1>
        </div>
        <div className="tv-stats">
          <span><b>{apps.length}</b> active apps</span>
          <span><b>{zapStats.perMin}</b> zaps/min</span>
          <span><b>{stats.total.toLocaleString("en-US")}</b> events</span>
          <span><b>{stats.relays}/{stats.relayList.length}</b> relays</span>
        </div>
        <Clock />
      </header>

      <section className="tv-view" key={view.id}>
        <h2>
          {view.title} <small>{view.sub}</small>
          {paused && <small className="tv-paused">paused</small>}
        </h2>
        <div className="tv-body">
          {view.id === "bubbles" && <Bubbles apps={apps} />}
          {view.id === "ranking" && (
            <div className="tv-ranking">
              <div>
                <h3>By users</h3>
                <Ranking ranking={ranking} period="day" by="users" />
              </div>
              <div>
                <h3>⚡ By sats zapped</h3>
                <Ranking ranking={ranking} period="day" by="sats" />
              </div>
            </div>
          )}
          {view.id === "zaps" && (
            <Zaps zaps={zaps.slice(0, 12)} zapStats={zapStats} profiles={profiles} getApp={getApp} />
          )}
        </div>
        {view.id === "ranking" && worker?.stale && (
          <p className="tv-note">⚠ The counter is offline: the ranking may be out of date.</p>
        )}
      </section>

      <footer className="tv-foot">
        <div className="tv-dots" aria-hidden="true">
          {views.length > 1 &&
            views.map((v, i) => <i key={v.id} className={i === index % views.length ? "on" : ""} />)}
        </div>
        <span className="tv-url">radarnostr.vercel.app</span>
        <a href="/" className="tv-exit">Exit TV mode</a>
      </footer>
      {rotating && (
        <div
          className="tv-progress"
          key={`${view.id}-${index}`}
          style={{ animationDuration: `${tv.seconds}s` }}
        />
      )}
    </div>
  );
}
