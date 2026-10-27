import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { callTool, mcpClient } from './expense-helpers';
import { loginAsAdmin, openFiscalYear, resetDatabase } from './helpers';
import { STORY_YEAR } from './story-year';

/**
 * Rechenschaft A3 — Berichte, Festschreiben, sonstiges Vermögen, Mittelverwendung (später). Seed: das Vorjahr ist
 * abgeschlossen, geprüft und mit dem abgelegten Prüfbericht freigegeben (D1), sein Kassenbericht festgeschrieben (A1/A2).
 */
test.describe('finance reports (Rechenschaft A3)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Kassenbericht festgeschrieben, Kontenabstimmung festschreiben, Vorschau als PDF', async ({ page }) => {
    await openFiscalYear(page, '/finance/reports', STORY_YEAR - 1);
    await expect(page.getByRole('heading', { level: 1, name: 'Berichte' })).toBeVisible();
    await expect(page.getByText('Die Freigabe lässt sich nicht mehr ändern.', { exact: false })).toBeVisible();

    await page.getByRole('link', { name: 'Kassenbericht' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kassenbericht');
    // Die Fassung aus dem Seed steht in der Tabelle, und der Bericht ist beim selben Datenstand festgeschrieben: Kein
    // späterer Seed ändert das abgeschlossene Vorjahr (Befund A3, Rechenschaft D1 Task 10b).
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('festgeschrieben');
    await expect(page.getByRole('row').filter({ hasText: /FBR-/ })).toHaveCount(1);

    // Rechenschaft C: Der Seed schreibt alle Berichte der MV fest (Schritt 10); die Kontenabstimmung (Prüfung) bleibt offen.
    // Zurück über den Kopf des Berichts, der das Jahr behält — der Eintrag „Berichte“ der Navigation öffnet die Vorgabe.
    await page.getByRole('main').getByRole('link', { name: 'Berichte' }).click();
    await page.getByRole('link', { name: 'Kontenabstimmung' }).click();
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('Prüffassung');
    // Die Seiten als Bilder (PdfPages), darunter „PDF öffnen“ auf die Vorschau.
    const sheet = page.getByRole('img', { name: /^Seite 1 von \d+: Kontenabstimmung/ });
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const previewUrl = await page.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href');
    const preview = await page.request.get(previewUrl!);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toBe('application/pdf');

    await page.getByTestId('report-finalize').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/^Kontenabstimmung .* festschreiben$/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Festschreiben' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('festgeschrieben');
    await expect(page.getByRole('row').filter({ hasText: /FBR-/ })).toHaveCount(1);
  });

  test('Sonstiges Vermögen: anlegen, neuer Wert, im Bericht des laufenden Jahres', async ({ page, baseURL }) => {
    await page.goto('/finance/reports');
    const yearSelect = page.getByTestId('reports-year').getByRole('combobox', { name: 'Geschäftsjahr' });
    const chosen = await yearSelect.inputValue();
    const openYearId = await yearSelect.locator('option').evaluateAll((options, skip) => (options as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== skip)!, chosen);

    await page.goto('/finance/other-assets');
    await page.getByTestId('other-assets-create').first().click();
    const create = page.getByTestId('other-asset-dialog');
    await create.getByLabel('Bezeichnung').fill('Kaution Lagerraum');
    await create.getByLabel('Wert').fill('300');
    await create.getByLabel('Seit').fill(associationDay(-30));
    await create.getByLabel('Grundlage').fill('Mietvertrag');
    await create.getByRole('button', { name: 'Anlegen' }).click();
    await expect(create).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: 'Kaution Lagerraum' });
    await expect(row).toContainText('300,00');

    await page.getByRole('button', { name: 'Aktionen für Kaution Lagerraum' }).click();
    await page.getByRole('menuitem', { name: 'Neuer Wert ab …' }).click();
    const revalue = page.getByTestId('other-asset-revalue');
    await revalue.getByLabel('Ab').fill(associationDay());
    await revalue.getByLabel('Wert').fill('250');
    await revalue.getByLabel('Grundlage').fill('Nachtrag zum Mietvertrag');
    await revalue.getByRole('button', { name: 'Speichern' }).click();
    await expect(revalue).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'Kaution Lagerraum' }).first()).toContainText('250,00');
    const ended = page.locator('details').filter({ hasText: 'Beendet' });
    await ended.locator('summary').click();
    await expect(ended.getByRole('row').filter({ hasText: 'Kaution Lagerraum' })).toContainText('300,00');

    // Die Vermögensübersicht des laufenden Jahres rechnet mit dem neuen Wert (Daten über den Verteiler).
    const client = await mcpClient(page, baseURL);
    const run = await callTool<{ data: { otherAssets: { items: { valueCents: number }[] } } }>(client, 'finance_report', { report: 'assetOverview', params: { fiscalYearId: openYearId } });
    expect(run.data.otherAssets.items.map((i) => i.valueCents)).toContain(25000);
  });

  test('Projektabrechnung mit Projektwahl und Übergabeliste zum Stichtag (Rechenschaft B1)', async ({ page }) => {
    const pdf = async () => {
      const src = await page.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href');
      const response = await page.request.get(src!);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('application/pdf');
    };
    await page.goto('/finance/reports');
    await page.getByRole('link', { name: 'Projektabrechnung' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Projektabrechnung');
    // Die Projektbuchungen des Seeds liegen im Stichjahr.
    await page.getByRole('combobox', { name: 'Geschäftsjahr' }).selectOption({ label: String(STORY_YEAR) });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(String(STORY_YEAR));
    const project = page.getByRole('combobox', { name: 'Projekt' });
    await expect(project.locator('option').nth(1)).toBeAttached();
    await project.selectOption({ index: 1 });
    await expect(page).toHaveURL(/[?&]project=/);
    await pdf();

    await page.getByRole('link', { name: 'Berichte' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Berichte' })).toBeVisible();
    await page.getByRole('link', { name: 'Übergabeliste' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Übergabeliste');
    // Ohne Stichtag in der Adresse gilt heute.
    await page.getByLabel('Stichtag').fill(`${STORY_YEAR}-06-30`);
    await expect(page).toHaveURL(new RegExp(`date=${STORY_YEAR}-06-30`));
    await pdf();
  });

  test('Datenexport für eine Außenprüfung: Vorjahr erzeugen, neue Zeile oben, ZIP herunterladen (Rechenschaft B2)', async ({ page }) => {
    await page.goto('/finance/reports');
    const card = page.getByTestId('data-export');
    const rows = card.locator('tr[data-export-row]');
    // Seed: ein Export des Vorjahres vor fünf Tagen; der vor 40 Tagen ist gelöscht und fehlt.
    await expect(rows).toHaveCount(1);
    const seeded = await rows.first().getAttribute('data-export-row');

    await card.getByTestId('data-export-start').click();
    const dialog = page.getByTestId('data-export-dialog');
    const previous = dialog.getByRole('checkbox', { name: String(STORY_YEAR - 1) });
    await expect(previous).toBeChecked();
    await dialog.getByRole('button', { name: 'Erzeugen' }).click();
    await expect(dialog).toBeHidden();

    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    const created = await rows.first().getAttribute('data-export-row');
    expect(created).not.toBe(seeded);
    const zip = await page.request.get(`/finance/data-export/${created}/file`);
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toBe('application/zip');
  });

  test('Mittelverwendung steht gedämpft mit „später“ und führt zu den Berichten', async ({ page }) => {
    await page.goto('/finance/reports');
    await page.getByRole('link', { name: 'Mittelverwendung, folgt später' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mittelverwendungsrechnung' })).toBeVisible();
    await page.getByRole('link', { name: 'Zu den Berichten' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Berichte' })).toBeVisible();
  });
});
