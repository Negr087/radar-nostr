// Minimal Supabase client for the worker and its scripts: HTTP only, no dependencies.

export function createSupabase({ url, secretKey }) {
  if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const headers = { apikey: secretKey, "Content-Type": "application/json" };
  // Legacy keys (service_role) are JWTs and also go in Authorization; new sb_secret_ keys don't.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  // `path` under /rest/v1/ (a table with filters, or rpc/<function>); returns the JSON
  // body, or null when there's none.
  async function request(path, { method = "POST", body, prefer } = {}) {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  const rpc = (fn, args) => request(`rpc/${fn}`, { body: args });

  return {
    addActivity: (rows) => rpc("add_activity", { rows }),
    heartbeat: ({ started, relays, relaysTotal }) =>
      rpc("worker_heartbeat", { started, relays, relays_total: relaysTotal }),
    listBlocks: () =>
      request("blocked_clients?select=pattern,match,reason,added_at&order=added_at", {
        method: "GET",
      }),
    // Adds or updates one block; returns the stored row.
    addBlock: async (row) =>
      (
        await request("blocked_clients?on_conflict=pattern", {
          body: row,
          prefer: "resolution=merge-duplicates,return=representation",
        })
      )[0],
    // Returns the removed rows (empty if there was no such block).
    removeBlock: (pattern) =>
      request(`blocked_clients?pattern=eq.${encodeURIComponent(pattern)}`, {
        method: "DELETE",
        prefer: "return=representation",
      }),
  };
}
