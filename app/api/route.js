import { SITE_URL, json } from "@/lib/api";

export { OPTIONS } from "@/lib/api";

// Index of the public API.
export function GET() {
  return json(
    {
      name: "Radar Nostr API",
      about: "Which Nostr apps people are using, counted 24/7 from public relays. Free, no key.",
      endpoints: {
        ranking: `${SITE_URL}/api/ranking?period=day&by=events&limit=10`,
        app: `${SITE_URL}/api/apps/primal`,
        status: `${SITE_URL}/api/status`,
      },
      options: {
        period: ["hour", "day", "week"],
        by: ["events", "sats", "users", "new"],
        limit: "1-50",
      },
      cache: "Responses are cached for about a minute.",
      source: "https://github.com/Negr087/radar-nostr",
    },
    { maxAge: 3600 }
  );
}
