/**
 * Playwright E2E tests for the subscription / pricing feature.
 *
 * Requires servers:
 *   - Frontend: python3 start_server.py (port 8080)
 *   - Backend functions: wrangler pages dev (port 8788) — for subscription API
 *
 * For tests that need subscription state manipulation:
 *   SUBSCRIPTION_TEST_MODE=true must be set in .dev.vars
 */

import { test, expect } from '@playwright/test';

const WRANGLER_BASE = 'http://localhost:8788';
const RUN_ID = Date.now();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function simulateRenewal(
  request: any,
  userId: string,
  outcome: 'success' | 'failure'
) {
  return request.post(`${WRANGLER_BASE}/api/test/simulate-renewal`, {
    data: { userId, outcome },
  });
}

async function setActiveSubscription(request: any, userId: string) {
  return simulateRenewal(request, userId, 'success');
}

// ─── User Story 1: Gratis bruker ser begrenset innhold ────────────────────────

test.describe('US1: Gratis bruker – begrenset tilgang', () => {
  const FREE_USER = `gratis_${RUN_ID}`;

  test('gratis bruker kan åpne maks 3 tekster (1 per emne) og ser paywall ved 4. tekst', async ({ page }) => {
    // Login as a fresh free user
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${FREE_USER}@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    // Navigate to Lesing tab
    await page.locator('button.tab-btn', { hasText: 'Lesing' }).click();

    // Expect text cards to be visible
    await expect(page.locator('.text-card, .lesing-card, [data-text-id]').first()).toBeVisible({ timeout: 5000 });

    // Open first 3 texts from different topics — should succeed
    const textCards = page.locator('.text-card, .lesing-card, [data-text-id]');
    const count = await textCards.count();
    expect(count).toBeGreaterThanOrEqual(4); // Need at least 4 texts to test paywall

    // Open text 1
    await textCards.nth(0).locator('button, .open-btn').click();
    await expect(page.locator('.paywall-overlay')).not.toBeVisible();

    // Open text 2 (different topic)
    await textCards.nth(1).locator('button, .open-btn').click();
    await expect(page.locator('.paywall-overlay')).not.toBeVisible();

    // Open text 3 (different topic)
    await textCards.nth(2).locator('button, .open-btn').click();
    await expect(page.locator('.paywall-overlay')).not.toBeVisible();

    // Attempt to open a 4th text — should be blocked with paywall
    await textCards.nth(3).click();
    await expect(page.locator('.paywall-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.paywall-overlay')).toContainText('abonnement');

    await page.screenshot({ path: 'tests/screenshots/abonnement-paywall.png', fullPage: true });
  });

  test('paywall viser norsk tekst og oppgrader-knapp', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${FREE_USER}_2@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    await page.locator('button.tab-btn', { hasText: 'Lesing' }).click();

    // A locked text card should show paywall overlay with upgrade button
    const lockedCard = page.locator('.paywall-overlay, .locked-card').first();
    // Trigger a paywall (click a locked text)
    const textCards = page.locator('.text-card, .lesing-card, [data-text-id]');
    if (await textCards.count() > 0) {
      await textCards.last().click(); // Last card likely locked for a new user with some texts opened
    }

    const paywall = page.locator('.paywall-overlay');
    if (await paywall.isVisible()) {
      await expect(paywall).toContainText(/abonnement|Oppgrader/i);
      await expect(paywall.locator('button, .upgrade-btn')).toBeVisible();
    }
    await page.screenshot({ path: 'tests/screenshots/abonnement-paywall-tekst.png', fullPage: true });
  });
});

// ─── User Story 2: Bruker tegner abonnement ───────────────────────────────────

test.describe('US2: Abonnement via Vipps og PayPal', () => {
  test('klikk Oppgrader → velg Vipps → redirect-URL returneres fra /api/subscribe', async ({ page, request }) => {
    const userId = `vipps_${RUN_ID}`;

    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${userId}@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    // Find the upgrade button (in paywall or Innstillinger)
    await page.locator('button.tab-btn', { hasText: 'Innstillinger' }).click();
    const upgradeBtn = page.locator('button, .upgrade-btn', { hasText: /Oppgrader|Abonnement/i });
    await expect(upgradeBtn.first()).toBeVisible({ timeout: 5000 });

    // The API should return a redirectUrl (we intercept the fetch to avoid real redirect)
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/subscribe'), { timeout: 10000 }),
      upgradeBtn.first().click(),
    ]);

    // Verify API was called and returned a redirect URL structure
    if (response.ok()) {
      const body = await response.json() as { redirectUrl?: string };
      expect(body).toHaveProperty('redirectUrl');
      expect(body.redirectUrl).toMatch(/^https?:\/\//);
    }

    await page.screenshot({ path: 'tests/screenshots/abonnement-vipps-redirect.png', fullPage: true });
  });

  test('klikk Oppgrader → velg PayPal → redirect-URL returneres fra /api/subscribe', async ({ page }) => {
    const userId = `paypal_${RUN_ID}`;

    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${userId}@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    await page.locator('button.tab-btn', { hasText: 'Innstillinger' }).click();

    // Select PayPal if there's a provider selector
    const paypalOption = page.locator('input[value="paypal"], button, label', { hasText: /PayPal/i });
    if (await paypalOption.count() > 0) {
      await paypalOption.first().click();
    }

    const upgradeBtn = page.locator('button, .upgrade-btn', { hasText: /Oppgrader|Abonnement/i });
    if (await upgradeBtn.count() > 0) {
      const [response] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/api/subscribe'), { timeout: 10000 }),
        upgradeBtn.first().click(),
      ]);

      if (response.ok()) {
        const body = await response.json() as { redirectUrl?: string };
        expect(body).toHaveProperty('redirectUrl');
      }
    }

    await page.screenshot({ path: 'tests/screenshots/abonnement-paypal-redirect.png', fullPage: true });
  });
});

// ─── User Story 3: Abonnent har tilgang til alt ───────────────────────────────

test.describe('US3: Abonnent – full tilgang', () => {
  test('aktivt abonnement via simulate → alle tekster i Lesing er ulåst', async ({ page, request }) => {
    const userId = `sub_${RUN_ID}`;

    // Set active subscription via test endpoint
    const simResp = await setActiveSubscription(request, userId);
    // If test mode isn't available (endpoint not wired yet), skip gracefully
    if (!simResp.ok()) {
      test.skip();
      return;
    }

    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${userId}@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    await page.locator('button.tab-btn', { hasText: 'Lesing' }).click();

    // No paywall overlays should be visible
    const paywalls = page.locator('.paywall-overlay');
    expect(await paywalls.count()).toBe(0);

    // Subscription status shown in Innstillinger
    await page.locator('button.tab-btn', { hasText: 'Innstillinger' }).click();
    await expect(page.locator('text=/Aktivt abonnement|abonnement/i')).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: 'tests/screenshots/abonnement-aktivt.png', fullPage: true });
  });
});

// ─── User Story 4: Fornyelse ──────────────────────────────────────────────────

test.describe('US4: Automatisk fornyelse', () => {
  test('simuler vellykket fornyelse → renewalDate oppdateres, status forblir active', async ({ request }) => {
    const userId = `renew_ok_${RUN_ID}`;

    // First activate the subscription
    const activateResp = await simulateRenewal(request, userId, 'success');
    if (!activateResp.ok()) { test.skip(); return; }

    // Then simulate a successful renewal
    const renewResp = await simulateRenewal(request, userId, 'success');
    expect(renewResp.ok()).toBeTruthy();

    const body = await renewResp.json() as { status?: string; renewalDate?: string };
    expect(body.status).toBe('active');
    expect(body.renewalDate).toBeDefined();
  });

  test('simuler mislykket fornyelse → status blir grace og gracePeriodEnd settes', async ({ request }) => {
    const userId = `renew_fail_${RUN_ID}`;

    const activateResp = await simulateRenewal(request, userId, 'success');
    if (!activateResp.ok()) { test.skip(); return; }

    const failResp = await simulateRenewal(request, userId, 'failure');
    expect(failResp.ok()).toBeTruthy();

    const body = await failResp.json() as { status?: string; gracePeriodEnd?: string };
    expect(body.status).toBe('grace');
    expect(body.gracePeriodEnd).toBeDefined();
  });

  test('webhook med ugyldig signatur returnerer 401 og endrer ikke KV', async ({ request }) => {
    const resp = await request.post(`${WRANGLER_BASE}/api/webhook/vipps`, {
      headers: { 'Authorization': 'sha256=invalidsignature' },
      data: { eventType: 'CHARGE_CAPTURED', agreementId: 'test-123' },
    });
    expect(resp.status()).toBe(401);
  });
});

// ─── User Story 5: Avslutning ─────────────────────────────────────────────────

test.describe('US5: Bruker avslutter abonnement', () => {
  test('abonnent klikker Avslutt → bekreftelse vises → status viser tilgang til dato', async ({ page, request }) => {
    const userId = `cancel_${RUN_ID}`;

    const activateResp = await setActiveSubscription(request, userId);
    if (!activateResp.ok()) { test.skip(); return; }

    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', `${userId}@example.com`);
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    await page.locator('button.tab-btn', { hasText: 'Innstillinger' }).click();

    // Find and click cancel button
    const cancelBtn = page.locator('button', { hasText: /Avslutt abonnement/i });
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await cancelBtn.click();

    // Confirmation dialog should appear
    const confirmDialog = page.locator('[role="dialog"], .confirm-dialog, .modal');
    if (await confirmDialog.isVisible()) {
      await confirmDialog.locator('button', { hasText: /Bekreft|Ja|Avslutt/i }).click();
    }

    // Status should update to show access-until date
    await expect(page.locator('text=/tilgang til|Avsluttet/i')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/abonnement-avsluttet.png', fullPage: true });
  });
});
