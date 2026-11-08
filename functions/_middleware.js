/**
 * _middleware.js — every response leaves through here.
 *
 * Two jobs only: make sure errors are JSON with a real status instead of a stack
 * trace, and set the security headers so the board can never be framed or leak a
 * referrer to whichever publisher an image came from.
 */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), interest-cohort=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
};

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function json(data, status = 200) {
  return withHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
}

export function apiError(code, message, status = 400) {
  return json({ error: { code, message } }, status);
}

export async function onRequest(context) {
  const { request, next } = context;

  try {
    const response = await next();
    // Assets keep their own caching; only the API is forced fresh.
    const isApi = new URL(request.url).pathname.startsWith("/api/");
    return withHeaders(response, isApi ? { "Cache-Control": "no-store" } : {});
  } catch (error) {
    console.error("unhandled", request.url, error?.stack ?? error);
    return apiError("internal", "The feed hit an unexpected error.", 500);
  }
}
