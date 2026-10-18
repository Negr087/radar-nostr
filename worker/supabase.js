// Minimal Supabase client for the worker: one RPC over HTTP, no dependencies.

export function createSupabase({ url, secretKey }) {
  if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const headers = { apikey: secretKey, "Content-Type": "application/json" };
  // Legacy keys (service_role) are JWTs and also go in Authorization; new sb_secret_ keys don't.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  return {
    async addActivity(rows) {
      const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/add_activity`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rows }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`add_activity ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
