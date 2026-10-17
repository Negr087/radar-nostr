"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";

const MAX_BUBBLES = 40;
const GAP = 4; // separación mínima entre burbujas (px)
const SLEEP_PX = 0.05; // si nada se mueve más que esto, la simulación se duerme

// Radio de cada burbuja: el área es proporcional a la actividad, y todo se escala
// para ocupar ~55% de la caja. Así entra igual en escritorio y en celular.
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

// Una burbuja por app: el tamaño es la actividad de los últimos 5 min,
// y "late" si tuvo un evento en los últimos 3 segundos.
// La posición la maneja una simulación simple (atracción al centro + choques),
// escrita directo al DOM en cada frame para no re-renderizar React 60 veces por segundo.
// Cuando todo se acomoda se duerme (si no, tiembla); se despierta si cambia algo.
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

  // Sincroniza los nodos con la lista: altas en un borde al azar, bajas, radio objetivo.
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
        // Con movimiento reducido, resolvemos la posición de una sin animar.
        for (let iter = 0; iter < (reduced ? 60 : 1); iter++) {
          for (const n of ns) {
            n.px = n.x;
            n.py = n.y;
            n.r += (n.target - n.r) * (reduced ? 1 : 0.15);
            if (Math.abs(n.target - n.r) < 0.1) n.r = n.target;
            // Atracción al centro, más fuerte en vertical para aprovechar el ancho.
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
                  // La más chica se mueve más: las grandes quedan ancladas al centro.
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
          Escuchando relays… las apps que firman sus eventos con el tag <code>client</code> van a
          aparecer acá.
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
              title={`${a.name} · ${a.count} eventos en 5 min`}
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
