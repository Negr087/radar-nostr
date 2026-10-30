// Helpers for the public API (app/api/): JSON with open CORS, cached by Vercel's CDN so
// traffic doesn't reach the database on every request.

export const SITE_URL = "https://radarnostr.vercel.app";

// `maxAge`: seconds the CDN serves it before asking again (and up to 5 min more while
// it refreshes in the background).
export function json(data, { status = 200, maxAge = 60 } = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control":
        status === 200 ? `public, s-maxage=${maxAge}, stale-while-revalidate=300` : "no-store",
    },
  });
}

export const error = (status, message) => json({ error: message }, { status });

// Preflight for browsers calling from other sites.
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// "app:primal" -> its page and slug; null for apps without a page.
export function appLinks(key) {
  const slug = typeof key === "string" && key.startsWith("app:") ? key.slice(4) : null;
  return { slug, page: slug ? `${SITE_URL}/app/${slug}` : null };
}
