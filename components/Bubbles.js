"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";

const MAX_BUBBLES = 40;
const GAP = 4; // minimum gap between bubbles (px)
const SLEEP_PX = 0.05; // if nothing moves more than this, the simulation goes to sleep

// Radius of each bubble: area is proportional to activity, and everything is scaled
// to fill ~55% of the box. That way it fits the same on desktop and mobile.
function targetRadii(apps, w, h) {
  if (!w || !h) return new Map();
  const max = Math.max(1, ...apps.map((a) => a.count));
  const short = Math.min(w, h);
  const minR = Math.max(20, short * 0.06);
  const maxR = short * 0.24;
  const raw = apps.map((a) => [a.key, minR + Math.sqrt(a.count / max) * (maxR - minR)]);
  const area = raw.reduce((s, [, r]) => s + Math.PI * r * r, 0);
  const k = Math.min(1, Math.sqrt((0.55 * w * h) / area));
  return new Map(raw.map(([key, r]) => [key, r * k]));
}

// One bubble per app: size is activity over the last 5 min,
// and it "beats" if it had an event in the last 3 seconds.
// Position comes from a simple simulation (pull to center + collisions),
// written straight to the DOM each frame so React doesn't re-render 60 times a second.
// Once everything settles it sleeps (otherwise it jitters); it wakes up when something changes.
export default function Bubbles({ apps, onSelect, selected }) {
  const boxRef = useRef(null);
  const nodes = useRef(new Map()); // key -> {x, y, r, target, el}
  const awake = useRef(true);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const list = apps.slice(0, MAX_BUBBLES);
  const now = Date.now();

  useEffect(() => {
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  // Sync nodes with the list: new ones spawn at a random edge, removals, target radius.
  const targets = targetRadii(list, size.w, size.h);
  for (const [key, target] of targets) {
    const n = nodes.current.get(key);
    if (n) {
      if (Math.abs(n.target - target) > 0.5) awake.current = true;
      n.target = target;
    } else {
      const a = Math.random() * Math.PI * 2;
      nodes.current.set(key, {
        x: size.w / 2 + Math.cos(a) * size.w * 0.45,
        y: size.h / 2 + Math.sin(a) * size.h * 0.45,
        r: 0,
        target,
        el: null,
      });
      awake.current = true;
    }
  }
  for (const key of nodes.current.keys()) {
    if (!targets.has(key)) {
      nodes.current.delete(key);
      awake.current = true;
    }
  }

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf;
    const step = () => {
      const box = boxRef.current;
      const w = box?.clientWidth || 0;
      const h = box?.clientHeight || 0;
      const ns = [...nodes.current.values()];
      if (awake.current && w && h) {
        let moved = 0;
        // With reduced motion, solve the layout in one go without animating.
        for (let iter = 0; iter < (reduced ? 60 : 1); iter++) {
          for (const n of ns) {
            n.px = n.x;
            n.py = n.y;
            n.r += (n.target - n.r) * (reduced ? 1 : 0.15);
            if (Math.abs(n.target - n.r) < 0.1) n.r = n.target;
            // Pull to center, stronger vertically to use the width.
            n.x += (w / 2 - n.x) * 0.01;
            n.y += (h / 2 - n.y) * 0.018;
          }
          for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < ns.length; i++) {
              for (let j = i + 1; j < ns.length; j++) {
                const a = ns[i];
                const b = ns[j];
                const dx = b.x - a.x || 0.01;
                const dy = b.y - a.y || 0.01;
                const dist = Math.hypot(dx, dy);
                const overlap = a.r + b.r + GAP - dist;
                if (overlap > 0) {
                  // The smaller one moves more: big bubbles stay anchored to the center.
                  const push = overlap / dist;
                  const wa = b.r / (a.r + b.r);
                  a.x -= dx * push * wa;
                  a.y -= dy * push * wa;
                  b.x += dx * push * (1 - wa);
                  b.y += dy * push * (1 - wa);
                }
              }
            }
            for (const n of ns) {
              n.x = Math.min(Math.max(n.x, n.r), w - n.r);
              n.y = Math.min(Math.max(n.y, n.r), h - n.r);
            }
          }
          moved = 0;
          for (const n of ns) moved = Math.max(moved, Math.abs(n.x - n.px), Math.abs(n.y - n.py));
        }
        const growing = ns.some((n) => n.r !== n.target);
        if (moved < SLEEP_PX && !growing) awake.current = false;
        for (const n of ns) {
          if (!n.el) continue;
          const d = n.r * 2;
          n.el.style.width = `${d}px`;
          n.el.style.height = `${d}px`;
          n.el.style.transform = `translate(${n.x - n.r}px, ${n.y - n.r}px)`;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="bubbles" ref={boxRef}>
      {!list.length && (
        <div className="empty">
          Listening to relays… apps that sign their events with the <code>client</code> tag will
          show up here.
        </div>
      )}
      {list.map((a) => {
        const hot = now - a.last < 3000;
        return (
          <div
            key={a.key}
            className="bubble-pos"
            ref={(el) => {
              const n = nodes.current.get(a.key);
              if (n) n.el = el;
            }}
          >
            <button
              type="button"
              className={`bubble ${hot ? "hot" : ""} ${selected === a.key ? "selected" : ""}`}
              title={`${a.name} · ${a.count} events in 5 min`}
              onClick={() => onSelect?.(a.key)}
            >
              <span className="bubble-logo">
                <Avatar src={a.pictures} seed={a.key} label={a.name} size="100%" rounded="30%" />
              </span>
              <span className="bubble-name">{a.name}</span>
            </button>
            <span className="bubble-count">{a.count}</span>
          </div>
        );
      })}
    </div>
  );
}
