import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test('adds a locale, fills it, and sees what removing it would cost', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/locales');
  await page.getByLabel('Sprachcode').fill('fr');
  await page.getByRole('button', { name: 'Sprache hinzufügen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'fr' })).toBeVisible();

  // Ein Projekt trägt mehrsprachige Felder; bis zum Cutover stand hier eine
  // Seite des Webseiten-Moduls.
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Projekt anlegen' }).click();
  await page.getByLabel('Slug (URL-Teil)').fill('grundversorgung');
  await page.getByLabel('Typ').selectOption('ongoing');
  await page.locator('[name="name.de"]').fill('Grundversorgung');
  await page.locator('[name="summary.de"]').fill('Futter und Wärme.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  // Anlegen leitet auf die Detailseite weiter; erst dort meldet das Speichern.
  await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
  await expect(page.locator('[name="name.fr"]')).toBeVisible();
  await page.locator('[name="name.fr"]').fill('Approvisionnement');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/admin/locales');
  await page.getByRole('button', { name: 'fr entfernen' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 Feld');
});

test('refuses to remove a locale the active template needs and names the reason', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/admin/locales');
  await page.getByRole('button', { name: 'en entfernen' }).click();
  // Die Ablehnung steht über der Liste, kein Dialog öffnet sich, und die Sprache bleibt.
  await expect(page.getByRole('alert').filter({ hasText: 'wird noch gebraucht' })).toContainText('site');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'en' }).first()).toBeVisible();
});
