import type { Env } from "../[[route]].js";

export interface Subscription {
  status: "active" | "inactive" | "cancelled" | "grace";
  provider: "vipps" | "paypal";
  agreementId: string;
  startDate: string;
  renewalDate: string;
  gracePeriodEnd: string | null;
  cancelledAt: string | null;
}

export async function getSubscription(env: Env, userId: string): Promise<Subscription | null> {
  const raw = await env.USER_DATA.get(`${userId}:subscription`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Subscription;
  } catch {
    return null;
  }
}

export async function setSubscription(env: Env, userId: string, sub: Subscription): Promise<void> {
  await env.USER_DATA.put(`${userId}:subscription`, JSON.stringify(sub));
}

/**
 * Derives active subscriber status from subscription record.
 * Active = status is "active", "grace", or "cancelled" but renewalDate is still in the future.
 */
export function isActiveSubscriber(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "grace") return true;
  if (sub.status === "cancelled" && sub.renewalDate) {
    return new Date(sub.renewalDate) > new Date();
  }
  return false;
}
