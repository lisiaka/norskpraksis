import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:8000';
const RUN_ID = Date.now();
const TEST_EMAIL = `ordbank_${RUN_ID}@example.com`;
const TEST_PASSWORD = 'passord123';
const TEST_NAME = 'Ordbankbruker';

async function loggInn(page: any) {
  await page.goto('/norsk_b2_pro.html');
  await page.fill('#login-input', TEST_EMAIL);
  await page.fill('#login-password', TEST_PASSWORD);
  await page.click('#login-btn');
  await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
}

async function gaaTilOrdbank(page: any) {
  await page.locator('button.tab-btn', { hasText: 'Ordbank' }).click();
}

async function leggTilOrd(page: any, norsk: string, betydning: string) {
  await page.fill('#fi-word', norsk);
  await page.fill('#fi-meaning', betydning);
  await page.locator('button.btn-add').click();
}

test.describe('Ordbank', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API_BASE}/auth/register`, {
      data: { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD },
    });
  });

  test('ordbank-fanen vises etter innlogging', async ({ page }) => {
    await loggInn(page);
    const tab = page.locator('button.tab-btn', { hasText: 'Ordbank' });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveClass(/active/);
  });

  test('kan legge til et nytt ord', async ({ page }) => {
    await loggInn(page);
    await gaaTilOrdbank(page);

    const testWord = `testord_${RUN_ID}`;
    await leggTilOrd(page, testWord, 'test word');

    await expect(page.locator('#word-list')).toContainText(testWord, { timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/ordbank-nytt-ord.png', fullPage: true });
  });

  test('ord er synlig etter reload (lagret i backend)', async ({ page }) => {
    await loggInn(page);
    await gaaTilOrdbank(page);

    const testWord = `reload_${RUN_ID}`;
    await leggTilOrd(page, testWord, 'reload test');
    await expect(page.locator('#word-list')).toContainText(testWord, { timeout: 5000 });

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('#login-screen')).toBeHidden({ timeout: 10000 });
    await gaaTilOrdbank(page);
    await expect(page.locator('#word-list')).toContainText(testWord, { timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/ordbank-persistent.png', fullPage: true });
  });

  test('kan slette et ord', async ({ page }) => {
    await loggInn(page);
    await gaaTilOrdbank(page);

    const wordToDelete = `slett_${RUN_ID}`;
    await leggTilOrd(page, wordToDelete, 'delete me');
    await expect(page.locator('#word-list')).toContainText(wordToDelete, { timeout: 5000 });

    // Click the × delete button inside the word's chip
    const chip = page.locator('#word-list .word-chip', { hasText: wordToDelete });
    await chip.locator('button.btn-del').click();

    await expect(page.locator('#word-list')).not.toContainText(wordToDelete, { timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/ordbank-slettet.png', fullPage: true });
  });

  test('kan søke i ordbanken', async ({ page }) => {
    await loggInn(page);
    await gaaTilOrdbank(page);

    // Add 6 words so search box appears (it shows when words.length > 5)
    for (let i = 0; i < 6; i++) {
      await leggTilOrd(page, `fyllord_${RUN_ID}_${i}`, `fill ${i}`);
    }
    const uniqueWord = `søkeord_${RUN_ID}`;
    await leggTilOrd(page, uniqueWord, 'search test');
    await expect(page.locator('#word-list')).toContainText(uniqueWord, { timeout: 5000 });

    // Navigate away and back so buildOrdbank() re-runs with updated word count
    await page.locator('button.tab-btn', { hasText: 'Flashcards' }).click();
    await gaaTilOrdbank(page);

    // Search box should now be visible
    const searchBox = page.locator('input.search-box');
    await expect(searchBox).toBeVisible({ timeout: 3000 });
    await searchBox.fill(uniqueWord);

    await expect(page.locator('#word-list')).toContainText(uniqueWord);
    await page.screenshot({ path: 'tests/screenshots/ordbank-søk.png', fullPage: true });
  });
});
