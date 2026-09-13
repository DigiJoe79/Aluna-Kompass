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
    await page.locator('[name="summary.de"]').fill('Kurztext.');
    await page.getByLabel('Bild Datei wählen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /hof-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Projekt „hofprojekt“');
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

  test('serves a file sandboxed, so an SVG cannot run in the origin of the app', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'sandbox.png', mimeType: 'image/png', buffer: PNG });
    const src = await page.getByRole('row', { name: /sandbox-/ }).locator('img').getAttribute('src');
    expect(src).toMatch(/^\/media\//);
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toBe('sandbox');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('says so when the same bytes are uploaded a second time, and names the folder they live in', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Ordnername').fill('bilder');
    await page.getByRole('button', { name: 'Neuer Ordner' }).click();
    await page.getByRole('link', { name: /bilder/ }).click();
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'einmal.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /einmal-/ })).toBeVisible();

    await page.getByRole('link', { name: 'Alle Dateien' }).click();
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'zweimal.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText(/Diese Datei gibt es schon: „einmal-[0-9a-f]+\.png“ im Ordner „bilder“/)).toBeVisible();
    await expect(page.getByRole('row', { name: /zweimal-/ })).toHaveCount(0);
  });

  test('remembers the grid view across a reload', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveClass(/bg-selected/);
  });

  test('"Alle Dateien" shows files from every folder', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Ordnername').fill('bilder');
    await page.getByRole('button', { name: 'Neuer Ordner' }).click();
    await page.getByRole('link', { name: /bilder/ }).click();
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'inbilder.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /inbilder-/ })).toBeVisible();

    await page.getByRole('link', { name: 'Alle Dateien' }).click();
    await expect(page).toHaveURL('/admin/media');
    await expect(page.getByRole('row', { name: /inbilder-/ })).toBeVisible();
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
