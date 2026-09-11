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

  test('bessert einen Tippfehler im Entwurf aus, statt ihn wegzuwerfen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Einladnug zur Versammlung');
    await page.getByLabel('Text').fill('Erster Wurf.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Bearbeiten' }).click();
    await expect(page.getByLabel('Betreff')).toHaveValue('Einladnug zur Versammlung');
    await expect(page.getByLabel('Text')).toHaveValue('Erster Wurf.');

    await page.getByLabel('Betreff').fill('Einladung zur Versammlung');
    await page.getByLabel('Text').fill('Zweiter Wurf.');
    await page.getByRole('button', { name: 'Änderungen speichern' }).click();

    await expect(page.getByRole('heading', { name: 'Einladung zur Versammlung' })).toBeVisible();
    // Immer noch ein Entwurf: keine Nummer, nichts festgeschrieben.
    await expect(page.getByText('Entwurf', { exact: true })).toBeVisible();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toHaveCount(0);
  });

  test('lässt das Datum des Schreibens setzen und später ausbessern', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Auf ein bestimmtes Datum');
    await page.getByLabel('Text').fill('Text.');
    await page.getByLabel('Datum auf dem Dokument').fill('2026-04-01');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page.getByText('2026-04-01')).toBeVisible();

    await page.getByRole('link', { name: 'Bearbeiten' }).click();
    await expect(page.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-04-01');
    await page.getByLabel('Datum auf dem Dokument').fill('2026-05-02');
    await page.getByRole('button', { name: 'Änderungen speichern' }).click();
    await expect(page.getByText('2026-05-02')).toBeVisible();
  });

  test('bietet für ein festgeschriebenes Dokument kein Bearbeiten an', async ({ page }) => {
    await login(page);
    await page.goto('/dms/new');
    await page.getByLabel('Betreff').fill('Fest und fertig');
    await page.getByLabel('Text').fill('Text.');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
    await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bearbeiten' })).toHaveCount(0);
  });

  test('nennt den Grund am Feld, statt auf Markierungen zu verweisen, die es nicht gibt', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    await page.getByLabel('Datei').setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('Text, kein PDF.') });
    await page.getByLabel('Datum auf dem Dokument').fill('2026-03-01');
    await page.getByLabel('Betreff').fill('Falscher Dateityp');
    await page.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByText('Nur PDF. Schriftverkehr wird als PDF abgelegt, damit er in zehn Jahren noch lesbar ist.')).toBeVisible();
    // Der allgemeine Kasten verweist nur dann auf Markierungen, wenn es welche gibt.
    await expect(page.getByText('Bitte prüfen Sie die markierten Felder.')).toHaveCount(0);
  });

  test('löscht ein Dokument, dessen Aufbewahrungsfrist abgelaufen ist', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    await page.getByLabel('Datei').setInputFiles({ name: 'Alte Rechnung.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await page.getByLabel('Dokumentart').selectOption('invoice');
    await page.getByLabel('Datum auf dem Dokument').fill('2005-06-01');
    await page.getByLabel('Betreff').fill('Abgelaufene Rechnung');
    await page.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByText(/RCH-\d{4}-\d{3}/)).toBeVisible();

    // Der Fristenbildschirm führt auf genau dieses Dokument.
    await page.goto('/admin/retention');
    await expect(page.getByRole('heading', { name: 'Dokumente' })).toBeVisible();
    await page.getByRole('link', { name: /Dokument RCH-/ }).click();

    await page.getByRole('button', { name: 'Endgültig löschen' }).click();
    await page.getByRole('button', { name: 'Löschung bestätigen' }).click();
    await expect(page).toHaveURL(/\/dms$/);
    await expect(page.getByText('Abgelaufene Rechnung')).toHaveCount(0);
  });

  test('lässt ein Dokument in laufender Frist nicht löschen', async ({ page }) => {
    await login(page);
    await page.goto('/dms/receive');
    await page.getByLabel('Datei').setInputFiles({ name: 'Neue Rechnung.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await page.getByLabel('Dokumentart').selectOption('invoice');
    await page.getByLabel('Datum auf dem Dokument').fill('2026-03-01');
    await page.getByLabel('Betreff').fill('Laufende Rechnung');
    await page.getByRole('button', { name: 'Ablegen' }).click();
    await expect(page.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
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
