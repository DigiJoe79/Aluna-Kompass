import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
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
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'hof.png', mimeType: 'image/png', buffer: PNG });
    await expect(chooser).toBeHidden();
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

  test('serves a webp preview for an uploaded image, sandboxed', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'vorschau.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('row', { name: /vorschau-/ }).click();
    const src = await page.getByRole('dialog').locator('img').getAttribute('src');
    const id = src!.replace(/\/preview$/, '').split('/').at(-1)!;
    const response = await page.request.get(`/media/${id}/preview`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    expect(response.headers()['content-security-policy']).toBe('sandbox');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    const missing = await page.request.get('/media/NOPE/preview');
    expect(missing.status()).toBe(404);
  });

  test('GET /media answers the listing as JSON and refuses bad parameters', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'json.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /json-/ })).toBeVisible();
    const ok = await page.request.get('/media?query=json&sort=name');
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { items: { filename: string }[]; folders: unknown[] };
    expect(body.items.map((i) => i.filename)).toEqual([expect.stringMatching(/^json-/)]);
    expect((await page.request.get('/media?kind=video')).status()).toBe(400);
  });

  test('searches by usage, filters by kind, sorts by name, and links the usage', async ({ page }) => {
    // Ein Hund mit Foto — die Suche soll ihn über das Verwendungs-Label finden.
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('rex');
    await page.getByLabel('Name').fill('Rex');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    const animalUrl = page.url();
    await page.getByRole('tab', { name: 'Fotos' }).click();
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles({ name: 'rex-foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(chooser.getByText('1 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await page.getByRole('button', { name: 'Fotos speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Fotos gespeichert');

    // Ein PDF für den Typfilter
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'satzung.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByRole('row', { name: /satzung-/ })).toBeVisible();

    await page.getByLabel('Suchen').fill('Rex');
    await page.getByRole('button', { name: 'Filtern' }).click();
    await expect(page).toHaveURL(/q=Rex/);
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /satzung-/ })).toHaveCount(0);

    await page.goto('/admin/media?kind=pdf');
    await expect(page.getByRole('row', { name: /satzung-/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /rex-foto-/ })).toHaveCount(0);

    await page.goto('/admin/media?sort=name');
    // Nur der Dateiname, nicht die Typ-Badge davor (die für PDF „PDF" zeigt).
    const names = await page.locator('tbody tr td:first-child span.font-mono').allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([...names.map((n) => n.trim())].sort((a, b) => a.localeCompare(b)));

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /rex-foto-/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Öffnen' })).toHaveAttribute('href', /^\/media\/[0-9A-Z]{26}$/);
    await dialog.getByRole('link', { name: 'Tier „Rex“' }).click();
    await expect(page).toHaveURL(animalUrl);
  });

  test('a file without a folder says so, and the list shows folder and date', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'lose.png', mimeType: 'image/png', buffer: PNG });
    const row = page.getByRole('row', { name: /lose-/ });
    await expect(row).toContainText('Ohne Ordner');
    await row.click();
    await expect(page.getByRole('dialog')).toContainText('Ohne Ordner');
  });
});
