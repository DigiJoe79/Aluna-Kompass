import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('media library', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('opens the detail dialog and blocks deleting an asset that is in use', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('hofprojekt');
    await page.locator('[name="name.de"]').fill('Hofprojekt');
    await page.getByLabel('Betterplace-Projekt-ID').fill('654321');
    await page.locator('[name="summary.de"]').fill('Kurztext.');
    await page.getByLabel('Bild Datei wählen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /hof-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Projekt „hofprojekt"');
    await expect(dialog.getByRole('button', { name: 'Löschen' })).toBeDisabled();
  });

  test('uploads a file, inspects it in the dialog and deletes it while unused', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'frei.png', mimeType: 'image/png', buffer: PNG });

    await page.getByRole('row', { name: /frei-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('nicht verwendet');
    await dialog.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('row', { name: /frei-/ })).toHaveCount(0);
  });

  test('remembers the grid view across a reload', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveClass(/bg-selected/);
  });

  test('creates a folder, opens it and deletes it while empty', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Ordnername').fill('kampagnen');
    await page.getByRole('button', { name: 'Neuer Ordner' }).click();

    const link = page.getByRole('link', { name: /kampagnen/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/folder=kampagnen/);

    await page.getByRole('button', { name: 'Ordner löschen' }).click();
    await expect(page).toHaveURL('/admin/media');
    await expect(page.getByRole('link', { name: /kampagnen/ })).toHaveCount(0);
  });
});
