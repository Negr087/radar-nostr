import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { loadAppPage } from "@/lib/appPage";
import { compactSats } from "@/lib/format";

// Share image for an app's page: its icon, name, today's numbers and 24 h chart.

export const alt = "An app's activity on Radar Nostr";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const MAX_ICON_BYTES = 1_000_000;

// The icon as a data URL: the bundled copy for apps in assets/og, otherwise the first
// candidate that downloads quickly as PNG or JPEG (what the image renderer supports).
// Null if none works, and a letter is drawn instead.
async function iconFor(app) {
  try {
    const png = await readFile(join(process.cwd(), "assets/og", `${app.slug}.png`));
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {}
  for (const url of app.pictures) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const type = res.headers.get("content-type")?.split(";")[0];
      if (!res.ok || !["image/png", "image/jpeg"].includes(type)) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_ICON_BYTES) continue;
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {}
  }
  return null;
}

export default async function OpengraphImage({ params }) {
  const { name } = await params;
  const app = await loadAppPage(name);
  const icon = app && (await iconFor(app));
  const peak = Math.max(1, ...(app?.points || []).map((p) => p.events));
  const stats = app
    ? [
        app.users
          ? [app.users.day.toLocaleString("en-US"), "users · 24 h"]
          : [app.day.toLocaleString("en-US"), "events · 24 h"],
        app.rank ? [`#${app.rank}`, "on Nostr today"] : null,
        app.satsWeek ? [compactSats(app.satsWeek), "sats zapped · 7 days"] : null,
      ].filter(Boolean)
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#0b0b12",
          backgroundImage:
            "radial-gradient(circle at 10% -10%, #2a1f4d 0, transparent 55%), radial-gradient(circle at 105% 105%, #3a230f 0, transparent 50%)",
          color: "#e7e7f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          {icon ? (
            <img src={icon} width={180} height={180} style={{ borderRadius: 44 }} />
          ) : (
            <div
              style={{
                width: 180,
                height: 180,
                borderRadius: 44,
                background: "#2c2c44",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 96,
                fontWeight: 800,
              }}
            >
              {(app?.name || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
            <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
              {(app?.name || "Unknown app").slice(0, 28)}
            </div>
            <div style={{ display: "flex", gap: 36 }}>
              {stats.map(([value, label]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 46, fontWeight: 700, color: "#a78bfa" }}>{value}</div>
                  <div style={{ fontSize: 22, color: "#8a8aa3" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
          {(app?.points || []).map((p) => (
            <div
              key={p.t}
              style={{
                flex: 1,
                height: `${Math.max(2, (p.events / peak) * 100)}%`,
                background: "#a78bfa",
                borderRadius: 4,
                opacity: 0.85,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 0 7px #22c55e33",
            }}
          />
          <div style={{ fontWeight: 800 }}>Radar Nostr</div>
          <div style={{ color: "#8a8aa3" }}>· which Nostr apps people are using</div>
        </div>
      </div>
    ),
    size
  );
}
