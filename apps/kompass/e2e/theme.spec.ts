import { expect, test } from '@playwright/test';

test('theme tokens reach computed styles and dark mode switches values', async ({ page }) => {
  await page.goto('/login');
  const button = page.getByRole('button', { name: 'Anmelden' });
  await expect(button).toHaveCSS('background-color', 'rgb(47, 93, 104)'); // #2F5D68 aus dem Default-Theme
  await page.evaluate(() => document.documentElement.setAttribute('data-color-scheme', 'dark'));
  await expect(button).toHaveCSS('background-color', 'rgb(116, 180, 192)'); // #74B4C0
});
