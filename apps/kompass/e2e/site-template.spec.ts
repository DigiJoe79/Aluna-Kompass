import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('reads a template, fills a variable and keeps a collection entry', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await expect(page.getByRole('region', { name: 'Befunde' })).toBeVisible();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Wir bauen Modelle');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.getByRole('link', { name: 'Aktuelles' }).click();
  await expect(page).toHaveURL('/site/c/news');
  await page.getByRole('link', { name: 'Neu' }).click();
  await page.getByLabel('Slug (URL-Teil)').fill('erste-notiz');
  await page.locator('[name="title.de"]').fill('Erste Notiz');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL('/site/c/news');
  await expect(page.getByRole('table')).toContainText('Erste Notiz');
});
