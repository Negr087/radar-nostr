import { error, json } from "@/lib/api";
import { rpc } from "@/lib/supabase";

export { OPTIONS } from "@/lib/api";
export const dynamic = "force-dynamic";

const STALE_S = 5 * 60; // same as the page's "counter offline" warning

// GET /api/status: whether the stored counts are up to date.
export async function GET() {
  let row;
  try {
    [row] = await rpc("radar_status", {});
  } catch {
    return error(503, "the database isn't reachable right now");
  }
  if (!row) return error(503, "the counter hasn't reported yet");
  return json(
    {
      up_to_date: row.age_seconds <= STALE_S,
      updated_at: row.updated_at,
      age_seconds: row.age_seconds,
      relays: { connected: row.relays, total: row.relays_total },
      counting_since: row.started_at,
    },
    { maxAge: 30 }
  );
}
