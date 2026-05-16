/**
 * POST /api/test/simulate-renewal
 *
 * Test-only endpoint — only active when SUBSCRIPTION_TEST_MODE=true.
 * Allows Playwright tests to trigger subscription state transitions without
 * real payment providers or waiting a month.
 *
 * Body: { userId: string, outcome: "success" | "failure" }
 *
 * Returns the resulting subscription record.
 */
import type { Env } from "../[[route]].js";
import { json } from "../[[route]].js";
import { getSubscription, setSubscription, type Subscription } from "../lib/subscription-kv.js";

export async function handleSimulateRenewal(request: Request, env: Env): Promise<Response> {
  let body: { userId?: string; outcome?: string };
  try { body = await request.json(); } catch { return json(400, { error: "Ugyldig JSON" }); }

  const { userId, outcome } = body;
  if (!userId) return json(400, { error: "userId mangler" });
  if (outcome !== "success" && outcome !== "failure") {
    return json(400, { error: "outcome må være 'success' eller 'failure'" });
  }

  const now = new Date();
  let sub: Subscription = await getSubscription(env, userId) ?? {
    status: "inactive",
    provider: "vipps",
    agreementId: `sim-${userId}`,
    startDate: now.toISOString(),
    renewalDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    gracePeriodEnd: null,
    cancelledAt: null,
  };

  if (outcome === "success") {
    sub.status = "active";
    sub.gracePeriodEnd = null;
    sub.renewalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    sub.status = "grace";
    sub.gracePeriodEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  }

  await setSubscription(env, userId, sub);
  return json(200, sub);
}
