import { appLinks, error, json } from "@/lib/api";
import { storedAppInfo } from "@/lib/knownApps";
import { RANKING_METRICS, RANKING_WINDOWS, fetchRanking } from "@/lib/ranking";

export { OPTIONS } from "@/lib/api";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

// GET /api/ranking?period=hour|day|week&by=events|sats|users|new&limit=10
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const period = params.get("period") || "day";
  const by = params.get("by") || "events";
  const limit = Number(params.get("limit") || 10);
  if (!(period in RANKING_WINDOWS)) return error(400, "period must be hour, day or week");
  if (!(by in RANKING_METRICS)) return error(400, "by must be events, sats, users or new");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return error(400, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }

  let items;
  try {
    items = await fetchRanking(by, RANKING_WINDOWS[period], limit);
  } catch {
    return error(503, "the ranking isn't available right now");
  }
  // "new" ranks by events since the app was first seen.
  const unit = by === "new" ? "events" : by;
  return json({
    period,
    by,
    generated_at: new Date().toISOString(),
    apps: items.map((item, i) => {
      const info = storedAppInfo(item.key, item);
      return {
        rank: i + 1,
        name: info.name,
        ...appLinks(item.key),
        website: info.website || null,
        icon: info.pictures[0] || null,
        [unit]: item.count,
        ...(item.zaps !== undefined && { zaps: item.zaps }),
        ...(item.firstSeen && { first_seen: new Date(item.firstSeen).toISOString() }),
        // % vs. the previous period; null when there isn't enough to compare.
        ...(RANKING_METRICS[by][1] && { trend_pct: item.trend }),
      };
    }),
  });
}
