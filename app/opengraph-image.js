import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Preview image shown when the link is shared (Nostr, X, WhatsApp…).
// Generated at build time with the same look as the site.

export const alt = "Radar Nostr: which Nostr apps people are using, right now";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// App bubbles: [x, y, diameter, logo]. Logos live in assets/og (192 px copies of each
// app's official icon) so the build doesn't depend on other sites being up.
const BUBBLES = [
  [760, 70, 250, "amethyst"],
  [1000, 210, 170, "nostrich"],
  [720, 330, 190, "primal"],
  [930, 400, 130, "damus"],
  [1060, 60, 110, "wisp"],
  [640, 220, 100, "zapstore"],
  [1080, 420, 90, "divine"],
];

async function logo(name) {
  const png = await readFile(join(process.cwd(), "assets/og", `${name}.png`));
  return `data:image/png;base64,${png.toString("base64")}`;
}

export default async function OpengraphImage() {
  const logos = Object.fromEntries(
    await Promise.all(BUBBLES.map(async ([, , , name]) => [name, await logo(name)]))
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#0b0b12",
          backgroundImage:
            "radial-gradient(circle at 10% -10%, #2a1f4d 0, transparent 55%), radial-gradient(circle at 105% 105%, #3a230f 0, transparent 50%)",
          color: "#e7e7f0",
          fontFamily: "sans-serif",
        }}
      >
        {BUBBLES.map(([x, y, d, name]) => (
          <div
            key={name}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: d,
              height: d,
              borderRadius: "50%",
              background: "radial-gradient(circle at 30% 25%, #2c2c44, #181826)",
              border: "2px solid #34344a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={logos[name]}
              width={d * 0.5}
              height={d * 0.5}
              style={{ borderRadius: d * 0.12 }}
            />
          </div>
        ))}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 72px",
            width: 640,
            gap: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 0 10px #22c55e33",
              }}
            />
            <div style={{ fontSize: 80, fontWeight: 800, letterSpacing: "-0.03em" }}>
              Radar Nostr
            </div>
          </div>
          <div style={{ fontSize: 38, color: "#c3c3d4", lineHeight: 1.3 }}>
            Which Nostr apps people are using, right now.
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            {["Live", "Ranking", "Zaps"].map((t) => (
              <div
                key={t}
                style={{
                  fontSize: 24,
                  color: "#a78bfa",
                  background: "#a78bfa22",
                  border: "1px solid #a78bfa55",
                  borderRadius: 999,
                  padding: "6px 18px",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size
  );
}
