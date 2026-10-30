import { appLinks, error, json } from "@/lib/api";
import { loadAppPage } from "@/lib/appPage";

export { OPTIONS } from "@/lib/api";
export const dynamic = "force-dynamic";

// GET /api/apps/<name>: one app's numbers (the same as its page).
export async function GET(request, { params }) {
  const { name } = await params;
  let app;
  try {
    app = await loadAppPage(name);
  } catch {
    return error(503, "the data isn't available right now");
  }
  if (!app) return error(404, "no app by that name on the radar (or it's blocked as spam)");

  return json({
    name: app.name,
    ...appLinks(app.key),
    website: app.website || null,
    icon: app.pictures[0] || null,
    first_seen: app.firstSeen,
    rank_today: app.rank,
    events: { hour: app.hour, day: app.day, week: app.week },
    users: app.users,
    zaps_week: { zaps: app.zapsWeek, sats: app.satsWeek },
    hourly_24h: app.points.map((p) => ({ hour: new Date(p.t).toISOString(), events: p.events })),
  });
}
