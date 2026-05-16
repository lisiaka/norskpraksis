/**
 * Cloudflare Pages Function — handles all /api/* routes.
 *
 * Secrets required (set via `wrangler secret put`):
 *   ANTHROPIC_API_KEY      — Anthropic Claude API key
 *   DEMO_PASSWORD          — shared demo password (legacy, kept for compat)
 *   VIPPS_CLIENT_ID        — Vipps Recurring API client ID
 *   VIPPS_CLIENT_SECRET    — Vipps Recurring API client secret
 *   VIPPS_SUBSCRIPTION_KEY — Vipps Ocp-Apim-Subscription-Key
 *   VIPPS_MERCHANT_SERIAL  — Vipps merchant serial number
 *   VIPPS_WEBHOOK_SECRET   — HMAC-SHA256 secret for Vipps webhooks
 *   PAYPAL_CLIENT_ID       — PayPal REST API client ID
 *   PAYPAL_CLIENT_SECRET   — PayPal REST API client secret
 *   PAYPAL_PLAN_ID         — Pre-created PayPal Billing Plan ID
 *   PAYPAL_WEBHOOK_ID      — PayPal Webhook ID for verification
 *
 * KV binding required (set in wrangler.toml):
 *   USER_DATA              — stores per-user data as "{userId}:{type}" keys
 *
 * Env vars (wrangler.toml [vars]):
 *   APP_BASE_URL           — e.g. https://norsk-b2-pro.pages.dev
 *   SUBSCRIPTION_TEST_MODE — "true" enables the simulate-renewal endpoint
 */

export interface Env {
  USER_DATA: KVNamespace;
  ANTHROPIC_API_KEY: string;
  DEMO_PASSWORD: string;
  // Subscription env vars
  APP_BASE_URL: string;
  SUBSCRIPTION_TEST_MODE?: string;
  // Vipps secrets
  VIPPS_CLIENT_ID?: string;
  VIPPS_CLIENT_SECRET?: string;
  VIPPS_SUBSCRIPTION_KEY?: string;
  VIPPS_MERCHANT_SERIAL?: string;
  VIPPS_WEBHOOK_SECRET?: string;
  // PayPal secrets
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_PLAN_ID?: string;
  PAYPAL_WEBHOOK_ID?: string;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Validate the X-Auth-Token header.
 * Token = btoa(userId + ':' + DEMO_PASSWORD)
 */
function validateToken(request: Request, env: Env, expectedUserId: string | null = null): boolean {
  const token = request.headers.get("X-Auth-Token") ?? "";
  if (!token) return false;
  try {
    const decoded = atob(token);
    const colon = decoded.indexOf(":");
    if (colon === -1) return false;
    const userId = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    if (password !== env.DEMO_PASSWORD) return false;
    if (expectedUserId && userId !== expectedUserId) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Response helpers ─────────────────────────────────────────────────────────

export function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function unauthorized(): Response {
  return json(401, { error: "Unauthorized" });
}

// ── Route helpers ─────────────────────────────────────────────────────────────

/**
 * Parse the URL path into route parts.
 * /api/{type}/{userId}  or  /api/login  or  /api/proxy/claude
 * /api/subscription/{userId}/cancel  → type="subscription", sub="userId/cancel"
 */
function parseRoute(url: string): { type: string; sub: string | null; rest: string[] } {
  const parts = new URL(url).pathname.replace(/^\/api\//, "").split("/");
  return { type: parts[0] ?? "", sub: parts[1] ?? null, rest: parts.slice(1) };
}

function sanitizeUserId(id: string | null): string | null {
  if (!id) return null;
  return id.replace(/\.\./g, "").replace(/[/\\]/g, "").slice(0, 64);
}

// ── KV helpers ────────────────────────────────────────────────────────────────

export async function kvGet(env: Env, userId: string, type: string, fallback: unknown): Promise<string> {
  if (!env.USER_DATA) throw new Error("KV binding USER_DATA is not configured");
  const val = await env.USER_DATA.get(`${userId}:${type}`);
  return val !== null ? val : JSON.stringify(fallback);
}

export async function kvPut(env: Env, userId: string, type: string, value: string): Promise<void> {
  if (!env.USER_DATA) throw new Error("KV binding USER_DATA is not configured");
  await env.USER_DATA.put(`${userId}:${type}`, value);
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { userId, password } = await request.json<{ userId: string; password: string }>();
  if (!userId || !password) return json(400, { error: "userId and password required" });
  if (password !== env.DEMO_PASSWORD) {
    return json(401, {
      error: "Feil passord",
      debug_env_set: !!env.DEMO_PASSWORD,
      debug_env_len: env.DEMO_PASSWORD?.length ?? 0,
    });
  }
  const token = btoa(userId + ":" + password);
  return json(200, { ok: true, token });
}

async function handleClaudeProxy(request: Request, env: Env): Promise<Response> {
  if (!validateToken(request, env)) return unauthorized();
  const payload = await request.json<Record<string, unknown>>();
  delete payload["__api_key__"];
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.arrayBuffer();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function handleGetUserData(
  request: Request,
  env: Env,
  userId: string,
  type: string
): Promise<Response> {
  if (!validateToken(request, env, userId)) return unauthorized();
  const fallback =
    type === "stats" ? { events: [] }
    : type === "essays" ? []
    : type === "sentences" ? {}
    : type === "words" ? []
    : type === "plan" ? null
    : type === "subscription" ? null
    : null;
  try {
    const data = await kvGet(env, userId, type, fallback);
    return new Response(data, {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
}

async function handlePostUserData(
  request: Request,
  env: Env,
  userId: string,
  type: string
): Promise<Response> {
  if (!validateToken(request, env, userId)) return unauthorized();
  const body = await request.text();

  if (type === "stats") {
    let event: unknown;
    try { event = JSON.parse(body); } catch { return json(400, { error: "Invalid JSON" }); }
    const existing = await env.USER_DATA.get(`${userId}:stats`);
    const db = existing ? JSON.parse(existing) as { events: unknown[] } : { events: [] };
    db.events.push(event);
    await kvPut(env, userId, "stats", JSON.stringify(db));
  } else {
    try { JSON.parse(body); } catch { return json(400, { error: "Invalid JSON" }); }
    await kvPut(env, userId, type, body);
  }
  return json(200, { ok: true });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function onRequest(context: EventContext<Env, string, unknown>): Promise<Response> {
  const { request, env } = context;
  const method = request.method;
  const url = request.url;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
      },
    });
  }

  const { type, sub, rest } = parseRoute(url);

  // POST /api/login
  if (type === "login" && method === "POST") return handleLogin(request, env);

  // POST /api/proxy/claude
  if (type === "proxy" && method === "POST") return handleClaudeProxy(request, env);

  // ── Subscription routes ───────────────────────────────────────────────────
  // Lazy import handlers to keep this file lean
  if (type === "subscribe" && method === "POST") {
    const { handleSubscribe } = await import("./handlers/subscription.js");
    return handleSubscribe(request, env);
  }

  if (type === "subscription" && sub) {
    const userId = sanitizeUserId(decodeURIComponent(sub));
    if (!userId) return json(400, { error: "Invalid userId" });

    // GET /api/subscription/{userId}
    if (method === "GET" && rest.length === 1) {
      const { handleGetSubscription } = await import("./handlers/subscription.js");
      return handleGetSubscription(request, env, userId);
    }

    // POST /api/subscription/{userId}/cancel
    if (method === "POST" && rest[1] === "cancel") {
      const { handleCancelSubscription } = await import("./handlers/subscription.js");
      return handleCancelSubscription(request, env, userId);
    }
  }

  // POST /api/webhook/vipps
  if (type === "webhook" && sub === "vipps" && method === "POST") {
    const { handleWebhookVipps } = await import("./handlers/webhook-vipps.js");
    return handleWebhookVipps(request, env);
  }

  // POST /api/webhook/paypal
  if (type === "webhook" && sub === "paypal" && method === "POST") {
    const { handleWebhookPaypal } = await import("./handlers/webhook-paypal.js");
    return handleWebhookPaypal(request, env);
  }

  // POST /api/test/simulate-renewal  (only when SUBSCRIPTION_TEST_MODE=true)
  if (type === "test" && sub === "simulate-renewal" && method === "POST") {
    if (env.SUBSCRIPTION_TEST_MODE !== "true") return json(403, { error: "Test mode is disabled" });
    const { handleSimulateRenewal } = await import("./handlers/test-simulate.js");
    return handleSimulateRenewal(request, env);
  }

  // ── Data routes: /api/{type}/{userId} ─────────────────────────────────────
  const DATA_TYPES = ["words", "sentences", "essays", "stats", "plan", "subscription"];
  if (DATA_TYPES.includes(type) && sub) {
    const userId = sanitizeUserId(decodeURIComponent(sub));
    if (!userId) return json(400, { error: "Invalid userId" });

    if (method === "GET") return handleGetUserData(request, env, userId, type);
    if (method === "POST") return handlePostUserData(request, env, userId, type);
  }

  return json(404, { error: "Not found" });
}
