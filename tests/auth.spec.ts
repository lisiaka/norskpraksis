import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8000';
const RUN_ID = Date.now();
const TEST_NAME = 'Testbruker';
const TEST_EMAIL = `test_${RUN_ID}@example.com`;
const TEST_PASSWORD = 'passord123';

test.describe('Registrering', () => {
  test('kan registrere ny bruker', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');

    // Switch to register mode via toggle link
    await page.click('#login-toggle');
    await expect(page.locator('#reg-name')).toBeVisible();

    await page.fill('#reg-name', TEST_NAME);
    await page.fill('#login-input', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-btn');

    // Login screen disappears after successful registration + auto-login
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: 'tests/screenshots/registrering.png', fullPage: true });
  });

  test('viser feil ved ugyldig e-post', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.click('#login-toggle');
    await page.fill('#reg-name', 'Test');
    await page.fill('#login-input', 'ikke-en-epost');
    await page.fill('#login-password', 'passord123');
    await page.click('#login-btn');

    // Should stay on login screen with error
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#login-screen')).toBeVisible();
  });

  test('registrer-knapp er deaktivert ved for kort passord', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.click('#login-toggle');
    await page.fill('#reg-name', 'Test');
    await page.fill('#login-input', `short_${RUN_ID}@example.com`);
    await page.fill('#login-password', 'kort');

    // Button disabled when password < 8 chars
    await expect(page.locator('#login-btn')).toBeDisabled();
  });
});

test.describe('Innlogging', () => {
  // Pre-register a user via API before these tests
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_BASE}/auth/register`, {
      data: { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD },
    });
  });

  test('kan logge inn med riktig e-post og passord', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-btn');

    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: 'tests/screenshots/innlogget.png', fullPage: true });
  });

  test('viser feil ved feil passord', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', TEST_EMAIL);
    await page.fill('#login-password', 'feil_passord_xyz');
    await page.click('#login-btn');

    await expect(page.locator('#login-error')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#login-screen')).toBeVisible();
  });

  test('kan logge ut', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    // Navigate to settings and log out
    await page.locator('button.tab-btn', { hasText: 'Innstillinger' }).click();
    await page.locator('button.btn-sec', { hasText: 'Logg ut' }).click();

    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/utlogget.png', fullPage: true });
  });

  test('auto-login med token lagret i localStorage', async ({ page }) => {
    // First login
    await page.goto('/norsk_b2_pro.html');
    await page.fill('#login-input', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-btn');
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });

    // Reload — should stay logged in via stored token
    await page.reload();
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
  });
});
