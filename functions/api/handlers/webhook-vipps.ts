import type { Env } from "../[[route]].js";
import { json } from "../[[route]].js";
import { getSubscription, setSubscription } from "../lib/subscription-kv.js";
import { verifyHmacSignature } from "../lib/crypto.js";
import { isAlreadyProcessed, markProcessed } from "../lib/idempotency.js";

interface VippsWebhookBody {
  eventType?: string;
  agreementId?: string;
  chargeId?: string;
}

export async function handleWebhookVipps(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  // Verify HMAC-SHA256 signature from Authorization header
  const authHeader = request.headers.get("Authorization") ?? "";
  // Vipps sends: Authorization: <sha256-hex-signature>
  const signature = authHeader.replace(/^sha256=/i, "");
  const secret = env.VIPPS_WEBHOOK_SECRET ?? "";

  const valid = await verifyHmacSignature(secret, rawBody, signature);
  if (!valid) {
    return json(401, { error: "Ugyldig webhook-signatur" });
  }

  let body: VippsWebhookBody;
  try { body = JSON.parse(rawBody) as VippsWebhookBody; } catch {
    return json(400, { error: "Ugyldig JSON" });
  }

  const eventId = body.chargeId ?? body.agreementId ?? crypto.randomUUID();
  const eventType = body.eventType ?? "";

  // Idempotency check
  if (await isAlreadyProcessed(env, eventId)) {
    return json(200, { ok: true, skipped: true });
  }

  // Find subscription by agreementId
  // NOTE: We store agreementId on the subscription. We need to find the userId.
  // In a full implementation, we'd have an index. For now, the agreementId IS the
  // lookup key stored in the subscription record. Vipps should send userId in externalId.
  const externalId = (body as Record<string, unknown>)["externalId"] as string | undefined;
  if (!externalId) {
    return json(400, { error: "externalId mangler i webhook-body" });
  }

  const sub = await getSubscription(env, externalId);
  if (!sub) {
    return json(404, { error: "Abonnement ikke funnet" });
  }

  const now = new Date();

  switch (eventType) {
    case "CHARGE_CAPTURED": {
      // Successful charge — renew
      sub.status = "active";
      sub.gracePeriodEnd = null;
      sub.renewalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    }
    case "CHARGE_FAILED": {
      // Failed charge — enter grace period
      sub.status = "grace";
      sub.gracePeriodEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      break;
    }
    case "AGREEMENT_UPDATED":
    case "AGREEMENT_STOPPED": {
      sub.status = "cancelled";
      sub.cancelledAt = now.toISOString();
      break;
    }
    default:
      // Unknown event — ignore but acknowledge
      return json(200, { ok: true, ignored: true });
  }

  await setSubscription(env, externalId, sub);
  await markProcessed(env, eventId, "vipps", eventType);

  return json(200, { ok: true });
}
