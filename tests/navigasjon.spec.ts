import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '';

async function loggInn(page: any) {
  await page.goto('/norsk_b2_pro.html');
  await page.fill('#login-input', TEST_EMAIL);
  await page.fill('#login-password', TEST_PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
}

function tabBtn(page: any, tekst: string) {
  return page.locator('button.tab-btn', { hasText: tekst });
}

test.describe('Innloggingsskjerm', () => {
  test('viser innloggingsskjerm med norsk tekst', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await expect(page.locator('h2')).toContainText('B2 Norsk Treningsverktøy');
    await expect(page.locator('#login-input')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/innlogging.png' });
  });

  test('logg inn-knapp er deaktivert når feltene er tomme', async ({ page }) => {
    await page.goto('/norsk_b2_pro.html');
    await expect(page.locator('#login-btn')).toBeDisabled();
  });
});

test.describe('Navigasjon etter innlogging', () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'TEST_EMAIL / TEST_PASSWORD ikke satt — hopper over autentiserte tester');

  test('ordbank-fane vises etter innlogging', async ({ page }) => {
    await loggInn(page);
    await expect(tabBtn(page, 'Ordbank')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/ordbank.png', fullPage: true });
  });

  test('kan navigere til Lesing', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Lesing').click();
    await expect(tabBtn(page, 'Lesing')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/lesing.png', fullPage: true });
  });

  test('kan navigere til Setninger', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Setninger').click();
    await expect(tabBtn(page, 'Setninger')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/setninger.png', fullPage: true });
  });

  test('kan navigere til Flashcards', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Flashcards').click();
    await expect(tabBtn(page, 'Flashcards')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/flashcards.png', fullPage: true });
  });

  test('kan navigere til Setningsbygging', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Setningsbygging').click();
    await expect(tabBtn(page, 'Setningsbygging')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/setningsbygging.png', fullPage: true });
  });

  test('kan navigere til Velg oppgave', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Velg oppgave').click();
    await expect(tabBtn(page, 'Velg oppgave')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/oppgaver.png', fullPage: true });
  });

  test('kan navigere til Skriv', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Skriv').click();
    await expect(tabBtn(page, 'Skriv')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/skriv.png', fullPage: true });
  });

  test('kan navigere til Plan', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Plan').click();
    await expect(tabBtn(page, 'Plan')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/plan.png', fullPage: true });
  });

  test('kan navigere til Statistikk', async ({ page }) => {
    await loggInn(page);
    await tabBtn(page, 'Statistikk').click();
    await expect(tabBtn(page, 'Statistikk')).toHaveClass(/active/);
    await page.screenshot({ path: 'tests/screenshots/statistikk.png', fullPage: true });
  });
});
