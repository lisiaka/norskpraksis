import type { Env } from "../[[route]].js";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function idempotencyKey(eventId: string): string {
  return `webhook:processed:${eventId}`;
}

/**
 * Returns true if this webhook event ID has already been processed.
 */
export async function isAlreadyProcessed(env: Env, eventId: string): Promise<boolean> {
  const val = await env.USER_DATA.get(idempotencyKey(eventId));
  return val !== null;
}

/**
 * Mark a webhook event as processed with a 30-day TTL.
 */
export async function markProcessed(
  env: Env,
  eventId: string,
  provider: string,
  type: string
): Promise<void> {
  await env.USER_DATA.put(
    idempotencyKey(eventId),
    JSON.stringify({ eventId, provider, type, processedAt: new Date().toISOString() }),
    { expirationTtl: TTL_SECONDS }
  );
}
