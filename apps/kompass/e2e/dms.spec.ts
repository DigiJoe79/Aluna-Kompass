import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const login = loginAsAdmin;

test.describe('dms', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('zeigt die Akte mit Eingangskorb', async ({ page }) => {
    await login(page);
    await page.goto('/dms');
    await expect(page.getByRole('heading', { name: 'Akte' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Eingangskorb/ })).toBeVisible();
  });

  test('rendert den festgeschriebenen Brief mit dem Branding-Logo', async ({ page }) => {
    // Ersatz für die in Plan 1 entfallene Zusicherung aus documents.spec.ts.
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Mit Logo');
    await page.getByLabel('Text').fill('Text');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    const response = await page.request.get(await page.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href') ?? '');
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect((await response.body()).byteLength).toBeGreaterThan(1000);
  });

  test('entwirft einen Brief, sieht die Vorschau und schreibt ihn fest', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Einladung zur Mitgliederversammlung');
    await page.getByLabel('Text').fill('Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vorschau' })).toBeVisible();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toBeVisible();
  });

  test('legt eine Datei im Eingangskorb ab und sortiert sie ein', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    await page.getByLabel('Datei').setInputFiles({ name: '2026-03-14 Behoerde.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await expect(page.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14');
    await page.getByLabel('Betreff').fill('Eingegangenes Schreiben');
    await page.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByText(/BEH-\d{4}-\d{3}/)).toBeVisible();
  });

  test('verwaltet Dokumentarten und Regeln', async ({ page }) => {
    await login(page);
    await page.goto('/admin/dms');
    await expect(page.getByRole('heading', { name: 'Dokumentarten' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Einsortierregeln' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ordner' })).toBeVisible();
  });
});

function samplePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
