"use client";

import { useState } from "react";

function hue(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// `src` puede ser una URL o una lista de candidatas: si una falla, prueba la siguiente.
// `size` en px, o un largo CSS ("100%") para que siga al contenedor.
export default function Avatar({ src, seed, label, size = 32, rounded = "50%" }) {
  const [broken, setBroken] = useState(() => new Set());
  const style = { width: size, height: size, borderRadius: rounded, flexShrink: 0 };
  const current = (Array.isArray(src) ? src : [src]).find((u) => u && !broken.has(u));

  if (current) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={current}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken((b) => new Set(b).add(current))}
        style={{ ...style, objectFit: "cover", background: "var(--panel-2)" }}
      />
    );
  }

  const initial = (label || seed || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      style={{
        ...style,
        display: "grid",
        placeItems: "center",
        background: `hsl(${hue(seed || label)} 45% 32%)`,
        color: "#fff",
        // cqw: relativo al contenedor (.bubble-logo declara container-type).
        fontSize: typeof size === "number" ? size * 0.42 : "42cqw",
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}
