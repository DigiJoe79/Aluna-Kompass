import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Die Projekte liegen im Kern, nicht im abgelösten Webseiten-Modul. Dieser
 * Ablauf lag bis zum Cutover in `website-lists.spec.ts` unter `/website/projects`.
 */
test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('create with an external link, then publish from the list', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('grundversorgung');
    await page.locator('[name="name.de"]').fill('Grundversorgung');
    await page.getByLabel('Typ').selectOption('ongoing');
    await page.getByRole('button', { name: 'Verweis hinzufügen' }).click();
    await page.getByLabel('Bezeichnung').fill('Spendenseite');
    await page.getByLabel('Adresse (https://…)').fill('https://example.org/spenden/grundversorgung');
    await page.locator('[name="summary.de"]').fill('Futter, Wärme und tierärztliche Versorgung.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.getByText('Finanzen folgen in einer späteren Stufe')).toBeVisible();

    await page.goto('/projects');
    const row = page.getByRole('row', { name: /Grundversorgung/ });
    await expect(row).toContainText('Dauerprojekt');
    await expect(row).toContainText('Spendenseite');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');
  });

  test('picks an existing image from the library for a project', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'bestand.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /bestand-/ })).toBeVisible();

    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('bestandsprojekt');
    await page.locator('[name="name.de"]').fill('Bestandsprojekt');
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Suchen').fill('bestand');
    await chooser.getByRole('button', { name: /bestand-/ }).click();
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.locator('input[name="imageAssetId"]')).toHaveValue(/^[0-9A-Z]{26}$/);
  });
});
