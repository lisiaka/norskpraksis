import type { Env } from "../[[route]].js";
import { json } from "../[[route]].js";
import { getSubscription, setSubscription, isActiveSubscriber } from "../lib/subscription-kv.js";
import { createAgreement, cancelAgreement } from "../lib/vipps.js";
import { createSubscription, cancelSubscription } from "../lib/paypal.js";

function authUserId(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  // Bearer token — sub claim is the userId (JWT, verified by caller)
  // For now, also accept X-User-Id header set by the Pages proxy layer (legacy)
  const userId = request.headers.get("X-User-Id") ?? auth.replace("Bearer ", "");
  return userId || null;
}

// ── GET /api/subscription/{userId} ───────────────────────────────────────────

export async function handleGetSubscription(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const sub = await getSubscription(env, userId);

  // Grace-period expiry: downgrade to inactive if gracePeriodEnd has passed
  if (sub?.status === "grace" && sub.gracePeriodEnd) {
    if (new Date(sub.gracePeriodEnd) < new Date()) {
      sub.status = "inactive";
      await setSubscription(env, userId, sub);
    }
  }

  if (!sub) return json(200, null);

  return json(200, {
    ...sub,
    isSubscriber: isActiveSubscriber(sub),
  });
}

// ── POST /api/subscribe ───────────────────────────────────────────────────────

export async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  let body: { userId?: string; provider?: string };
  try { body = await request.json(); } catch { return json(400, { error: "Ugyldig JSON" }); }

  const { userId, provider } = body;
  if (!userId) return json(400, { error: "userId mangler" });
  if (provider !== "vipps" && provider !== "paypal") {
    return json(400, { error: "provider må være 'vipps' eller 'paypal'" });
  }

  // Block duplicate active subscriptions
  const existing = await getSubscription(env, userId);
  if (existing && isActiveSubscriber(existing)) {
    return json(409, { error: "Bruker har allerede et aktivt abonnement" });
  }

  const baseUrl = env.APP_BASE_URL ?? "http://localhost:8788";

  try {
    if (provider === "vipps") {
      const { agreementId, redirectUrl } = await createAgreement(env, userId, baseUrl);
      // Store pending state
      await setSubscription(env, userId, {
        status: "inactive",
        provider: "vipps",
        agreementId,
        startDate: new Date().toISOString(),
        renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        gracePeriodEnd: null,
        cancelledAt: null,
      });
      return json(200, { redirectUrl });
    } else {
      const { subscriptionId, redirectUrl } = await createSubscription(env, userId, baseUrl);
      await setSubscription(env, userId, {
        status: "inactive",
        provider: "paypal",
        agreementId: subscriptionId,
        startDate: new Date().toISOString(),
        renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        gracePeriodEnd: null,
        cancelledAt: null,
      });
      return json(200, { redirectUrl });
    }
  } catch (e) {
    return json(502, { error: `Betalingsleverandør feil: ${(e as Error).message}` });
  }
}

// ── POST /api/subscription/{userId}/cancel ────────────────────────────────────

export async function handleCancelSubscription(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const sub = await getSubscription(env, userId);
  if (!sub || !isActiveSubscriber(sub)) {
    return json(404, { error: "Ingen aktivt abonnement funnet" });
  }

  try {
    if (sub.provider === "vipps") {
      await cancelAgreement(env, sub.agreementId);
    } else if (sub.provider === "paypal") {
      await cancelSubscription(env, sub.agreementId);
    }
  } catch (e) {
    return json(502, { error: `Feil ved avslutning: ${(e as Error).message}` });
  }

  sub.status = "cancelled";
  sub.cancelledAt = new Date().toISOString();
  await setSubscription(env, userId, sub);

  return json(200, {
    ok: true,
    status: "cancelled",
    accessUntil: sub.renewalDate,
  });
}
