import type { Env } from "../[[route]].js";
import { json } from "../[[route]].js";
import { getSubscription, setSubscription } from "../lib/subscription-kv.js";
import { verifyWebhookSignature } from "../lib/paypal.js";
import { isAlreadyProcessed, markProcessed } from "../lib/idempotency.js";

interface PayPalWebhookBody {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    billing_agreement_id?: string;
  };
}

export async function handleWebhookPaypal(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  // Verify PayPal webhook signature via their verify endpoint
  const valid = await verifyWebhookSignature(env, request.headers, rawBody);
  if (!valid) {
    return json(401, { error: "Ugyldig PayPal webhook-signatur" });
  }

  let body: PayPalWebhookBody;
  try { body = JSON.parse(rawBody) as PayPalWebhookBody; } catch {
    return json(400, { error: "Ugyldig JSON" });
  }

  const eventId = body.id ?? crypto.randomUUID();
  const eventType = body.event_type ?? "";

  // Idempotency check
  if (await isAlreadyProcessed(env, eventId)) {
    return json(200, { ok: true, skipped: true });
  }

  // Resolve userId from custom_id set when creating the subscription
  const userId = body.resource?.custom_id ?? "";
  if (!userId) {
    return json(400, { error: "custom_id (userId) mangler i webhook-body" });
  }

  const sub = await getSubscription(env, userId);
  if (!sub) {
    return json(404, { error: "Abonnement ikke funnet" });
  }

  const now = new Date();

  switch (eventType) {
    case "PAYMENT.SALE.COMPLETED":
    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      sub.status = "active";
      sub.gracePeriodEnd = null;
      sub.renewalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    }
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
      sub.status = "grace";
      sub.gracePeriodEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      break;
    }
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED": {
      sub.status = "cancelled";
      sub.cancelledAt = now.toISOString();
      break;
    }
    default:
      return json(200, { ok: true, ignored: true });
  }

  await setSubscription(env, userId, sub);
  await markProcessed(env, eventId, "paypal", eventType);

  return json(200, { ok: true });
}
