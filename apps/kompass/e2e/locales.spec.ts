import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('adds a locale, fills it, and sees what removing it would cost', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/locales');
  await page.getByLabel('Sprachcode').fill('fr');
  await page.getByRole('button', { name: 'Sprache hinzufügen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'fr' })).toBeVisible();

  await page.goto('/website/pages/about');
  await expect(page.locator('[name="title.fr"]')).toBeVisible();
  await page.locator('[name="title.fr"]').fill('À propos');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/admin/locales');
  await page.getByRole('button', { name: 'fr entfernen' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 Feld');
});
