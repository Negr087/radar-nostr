// Read-only access to the radar's database (counts stored 24/7 by the worker).
// The anon key is public by design: row level security only allows reads.
// If the project's API keys are rotated, update SUPABASE_ANON_KEY here.

export const SUPABASE_URL = "https://xqckpjbkzlafxidrwfju.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxY2twamJremxhZnhpZHJ3Zmp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyODc3MTAsImV4cCI6MjEwNzg2MzcxMH0.6ZAB-D7PCckTuHfIp9ZZ09edhTQ7DVJQDY32HytL43w";

// Calls a database function (see supabase/schema.sql) and returns its rows.
export async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}
