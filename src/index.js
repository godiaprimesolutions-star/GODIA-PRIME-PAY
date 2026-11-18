/**
 * GODIA PRIME PAY — Cloudflare Worker starter.
 *
 * Payment routes are intentionally not implemented yet. Add Daraja STK Push
 * only after configuring encrypted Worker secrets and a verified callback.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        app: "GODIA PRIME PAY",
        environment: env.ENVIRONMENT || "development",
        payments: "not-configured"
      }), { status: 200, headers: JSON_HEADERS });
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({
        ok: false,
        error: "This API route is not implemented yet."
      }), { status: 501, headers: JSON_HEADERS });
    }

    return env.ASSETS.fetch(request);
  }
};
