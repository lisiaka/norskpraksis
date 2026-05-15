import { test, expect } from '@playwright/test';

test('hovesiden laster', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});
