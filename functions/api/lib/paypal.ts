import type { Env } from "../[[route]].js";

const PAYPAL_BASE = "https://api-m.sandbox.paypal.com"; // Sandbox; swap to api-m.paypal.com for prod

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
}

interface PayPalSubscriptionResponse {
  id: string;
  links: Array<{ href: string; rel: string; method: string }>;
}

export async function getAccessToken(env: Env): Promise<string> {
  const creds = btoa(`${env.PAYPAL_CLIENT_ID ?? ""}:${env.PAYPAL_CLIENT_SECRET ?? ""}`);
  const resp = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) throw new Error(`PayPal token error: ${resp.status}`);
  const data = await resp.json<PayPalTokenResponse>();
  return data.access_token;
}

export async function createSubscription(
  env: Env,
  userId: string,
  returnUrl: string
): Promise<{ subscriptionId: string; redirectUrl: string }> {
  const token = await getAccessToken(env);
  const body = {
    plan_id: env.PAYPAL_PLAN_ID ?? "",
    custom_id: userId,
    application_context: {
      return_url: `${returnUrl}?subscriptionStatus=success&provider=paypal&userId=${encodeURIComponent(userId)}`,
      cancel_url: `${returnUrl}?subscriptionStatus=cancelled&provider=paypal`,
      brand_name: "B2 Norsk Treningsverktøy",
      locale: "nb-NO",
      user_action: "SUBSCRIBE_NOW",
    },
  };

  const resp = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`PayPal createSubscription failed (${resp.status}): ${err}`);
  }

  const data = await resp.json<PayPalSubscriptionResponse>();
  const approveLink = data.links.find(l => l.rel === "approve");
  if (!approveLink) throw new Error("PayPal: no approve link in response");

  return { subscriptionId: data.id, redirectUrl: approveLink.href };
}

export async function cancelSubscription(env: Env, subscriptionId: string): Promise<void> {
  const token = await getAccessToken(env);
  const resp = await fetch(
    `${PAYPAL_BASE}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Avsluttet av bruker" }),
    }
  );
  // 204 = success, 422 = already cancelled (both fine)
  if (!resp.ok && resp.status !== 422) {
    const err = await resp.text();
    throw new Error(`PayPal cancelSubscription failed (${resp.status}): ${err}`);
  }
}

/**
 * Verify a PayPal webhook signature by calling PayPal's verify endpoint.
 */
export async function verifyWebhookSignature(
  env: Env,
  headers: Headers,
  rawBody: string
): Promise<boolean> {
  const token = await getAccessToken(env);
  const payload = {
    auth_algo: headers.get("PAYPAL-AUTH-ALGO") ?? "",
    cert_url: headers.get("PAYPAL-CERT-URL") ?? "",
    transmission_id: headers.get("PAYPAL-TRANSMISSION-ID") ?? "",
    transmission_sig: headers.get("PAYPAL-TRANSMISSION-SIG") ?? "",
    transmission_time: headers.get("PAYPAL-TRANSMISSION-TIME") ?? "",
    webhook_id: env.PAYPAL_WEBHOOK_ID ?? "",
    webhook_event: JSON.parse(rawBody) as unknown,
  };

  const resp = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return false;
  const data = await resp.json<{ verification_status: string }>();
  return data.verification_status === "SUCCESS";
}
