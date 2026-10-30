// Minimal Supabase client for the worker: RPCs over HTTP, no dependencies.

export function createSupabase({ url, secretKey }) {
  if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const headers = { apikey: secretKey, "Content-Type": "application/json" };
  // Legacy keys (service_role) are JWTs and also go in Authorization; new sb_secret_ keys don't.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  async function rpc(fn, args) {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`${fn} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return {
    addActivity: (rows) => rpc("add_activity", { rows }),
    heartbeat: ({ started, relays, relaysTotal }) =>
      rpc("worker_heartbeat", { started, relays, relays_total: relaysTotal }),
  };
}
