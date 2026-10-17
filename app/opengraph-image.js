import { ImageResponse } from "next/og";

// Preview image shown when the link is shared (Nostr, X, WhatsApp…).
// Generated at build time with the same look as the site.

export const alt = "Radar Nostr: which Nostr apps people are using, right now";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Decorative bubbles: [x, y, diameter, color, letter]. Category colors.
const BUBBLES = [
  [760, 70, 250, "#a78bfa", "A"],
  [1000, 210, 170, "#f7931a", "N"],
  [720, 330, 190, "#22d3ee", "P"],
  [930, 400, 130, "#f472b6", "D"],
  [1060, 60, 110, "#34d399", "W"],
  [640, 220, 100, "#fbbf24", "Y"],
  [1080, 420, 90, "#60a5fa", "O"],
];

export default function OpengraphImage() {
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
        {BUBBLES.map(([x, y, d, color, letter]) => (
          <div
            key={letter}
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
            <div
              style={{
                width: d * 0.42,
                height: d * 0.42,
                borderRadius: d * 0.12,
                background: color,
                color: "#111",
                fontSize: d * 0.22,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {letter}
            </div>
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
