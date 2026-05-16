import type { Env } from "../[[route]].js";

const VIPPS_BASE = "https://apitest.vipps.no"; // Sandbox; replace with apitest.vipps.no → api.vipps.no for prod

interface VippsTokenResponse {
  access_token: string;
  expires_in: number;
}

interface VippsAgreementResponse {
  agreementId: string;
  vippsConfirmationUrl: string;
}

export async function getAccessToken(env: Env): Promise<string> {
  const resp = await fetch(`${VIPPS_BASE}/accesstoken/get`, {
    method: "POST",
    headers: {
      "client_id": env.VIPPS_CLIENT_ID ?? "",
      "client_secret": env.VIPPS_CLIENT_SECRET ?? "",
      "Ocp-Apim-Subscription-Key": env.VIPPS_SUBSCRIPTION_KEY ?? "",
    },
  });
  if (!resp.ok) throw new Error(`Vipps token error: ${resp.status}`);
  const data = await resp.json<VippsTokenResponse>();
  return data.access_token;
}

export async function createAgreement(
  env: Env,
  userId: string,
  returnUrl: string
): Promise<{ agreementId: string; redirectUrl: string }> {
  const token = await getAccessToken(env);
  const body = {
    pricing: { type: "LEGACY", amount: 9900, currency: "NOK" }, // 99 kr in øre
    interval: { unit: "MONTH", count: 1 },
    merchantAgreementUrl: returnUrl,
    merchantRedirectUrl: `${returnUrl}?subscriptionStatus=success&provider=vipps&userId=${encodeURIComponent(userId)}`,
    productName: "B2 Norsk — Månedlig abonnement",
    productDescription: "Ubegrenset tilgang til alle B2-tekster",
    externalId: userId,
  };

  const resp = await fetch(`${VIPPS_BASE}/recurring/v3/agreements`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": env.VIPPS_SUBSCRIPTION_KEY ?? "",
      "Merchant-Serial-Number": env.VIPPS_MERCHANT_SERIAL ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vipps createAgreement failed (${resp.status}): ${err}`);
  }

  const data = await resp.json<VippsAgreementResponse>();
  return { agreementId: data.agreementId, redirectUrl: data.vippsConfirmationUrl };
}

export async function cancelAgreement(env: Env, agreementId: string): Promise<void> {
  const token = await getAccessToken(env);
  const resp = await fetch(`${VIPPS_BASE}/recurring/v3/agreements/${encodeURIComponent(agreementId)}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": env.VIPPS_SUBSCRIPTION_KEY ?? "",
      "Merchant-Serial-Number": env.VIPPS_MERCHANT_SERIAL ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "STOPPED" }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vipps cancelAgreement failed (${resp.status}): ${err}`);
  }
}
