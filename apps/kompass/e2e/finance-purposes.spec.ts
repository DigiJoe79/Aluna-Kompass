import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { backToAdmin, callTool, mcpClient, PDF, PHONE, switchTo, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase } from './helpers';
import { story } from './story-year';

/** > 1 MB (N9, Befundliste 0.2.0) — derselbe erfundene Beleg wie bei den Auslagen. */
const BIG_PDF = path.resolve(import.meta.dirname, 'fixtures/beleg-1500k.pdf');

const row = (page: Page, name: string) => page.getByTestId('purpose-row').filter({ hasText: name });

/** Jonas Feld (Freigeber) gibt die wartende Umwidmung frei, deren Zeile `label` trägt. */
async function approveAsJonas(page: Page, label: string, expectInDetail: string[]): Promise<void> {
  await switchToJonas(page);
  await page.goto('/finance/approvals');
  await page.getByTestId('approval-queue-item').filter({ hasText: label }).click();
  await expect(page.getByTestId('purpose-transfer-detail')).toBeVisible();
  for (const text of expectInDetail) await expect(page.getByText(text).first()).toBeVisible();
  await page.getByTestId('purpose-transfer-approve').click();
  await expect(page.getByTestId('purpose-transfer-result')).toContainText('Freigegeben');
  await backToAdmin(page);
}

/**
 * F8b Task 6a — Finanzen → Zwecke (E3), Zweck ändern (E5) und die gemeinsame
 * Detailansicht der Freigabe (HANDOFF 14.3 Punkt 5). Die Verwaltung (Admin)
 * legt Umwidmungen an; Jonas Feld gibt frei — nie dieselbe Person.
 */
test.describe('finance purposes (F8b)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Umwidmung mit Upload über 1 MB und mit Beschluss aus der Akte, Freigabe durch eine zweite Person, Bestände, erfüllt mit Rest, Wieder öffnen mit Begründung', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Tierarztfonds E2E', targetCents: 50000 } });
    await callTool(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Winterfutter E2E' } });
    await callTool(client, 'dms_receive', { filename: 'protokoll.pdf', typeKey: 'minutes', subject: 'Protokoll Mittelumwidmung E2E', documentDate: story('2026-01-15'), contentBase64: PDF.buffer.toString('base64') });

    // 1. Aus den freien Mitteln in den Zweck — Beschluss als Upload über 1 MB.
    await page.goto('/finance/purposes');
    await page.getByTestId('purposes-transfer-trigger').click();
    // Entscheidung 6: ein Formular wie D1, kein Dialog.
    await expect(page).toHaveURL(/\/finance\/purposes\/transfer$/);
    const form = page.getByTestId('transfer-form');
    await expect(page.getByTestId('transfer-approvers')).toContainText('Jonas Feld');
    await form.locator('#transfer-to').selectOption({ label: 'Tierarztfonds E2E · Bestand 0,00 €' });
    await form.locator('#transfer-amount').fill('300,00');
    await form.locator('#transfer-reason').fill('Spendenaufruf für Behandlungen');
    await form.getByTestId('voucher-file-input').setInputFiles(BIG_PDF);
    await expect(page.getByTestId('transfer-document-chosen')).toContainText('beleg-1500k.pdf');
    await page.getByTestId('transfer-save').click();
    await expect(page).toHaveURL(/\/finance\/purposes$/);
    await approveAsJonas(page, 'freie Mittel → Tierarztfonds E2E', ['Beschluss liegt vor', '300,00 €']);

    await page.goto('/finance/purposes');
    await expect(row(page, 'Tierarztfonds E2E').getByTestId('purpose-balance')).toHaveText('300,00 €');

    // 2. Von Zweck zu Zweck — Beschluss aus der Akte gewählt.
    await row(page, 'Tierarztfonds E2E').getByRole('button', { name: 'Tierarztfonds E2E' }).click();
    await expect(page.getByTestId('purpose-movements')).toContainText('Umwidmung, Zugang');
    await page.getByTestId('purpose-transfer').click();
    // „von“ ist vorbelegt und nennt den Bestand (Designer-README 4e).
    await expect(form.locator('#transfer-from').locator('option:checked')).toHaveText('Tierarztfonds E2E · Bestand 300,00 €');
    await form.locator('#transfer-to').selectOption({ label: 'Winterfutter E2E · Bestand 0,00 €' });
    await form.locator('#transfer-amount').fill('100,00');
    await form.locator('#transfer-reason').fill('Kälteeinbruch');
    await form.getByRole('button', { name: 'Aus der Akte wählen' }).click();
    await form.getByRole('combobox', { name: 'Beschluss auswählen' }).fill('Mittelumwidmung');
    await page.getByTestId('document-option').first().click();
    await page.getByTestId('transfer-save').click();
    await expect(page).toHaveURL(/\/finance\/purposes$/);
    await approveAsJonas(page, 'Tierarztfonds E2E → Winterfutter E2E', ['Beschluss liegt vor', 'Bestand Tierarztfonds E2E']);

    await page.goto('/finance/purposes');
    await expect(row(page, 'Tierarztfonds E2E').getByTestId('purpose-balance')).toHaveText('200,00 €');
    await expect(row(page, 'Winterfutter E2E').getByTestId('purpose-balance')).toHaveText('100,00 €');

    // 3. Als erfüllt kennzeichnen — mit Rest-Warnung, danach „erfüllt, 200,00 € Rest“.
    await row(page, 'Tierarztfonds E2E').getByRole('button', { name: 'Tierarztfonds E2E' }).click();
    await expect(page.getByTestId('purpose-movements')).toContainText('Umwidmung, Abgang');
    await page.getByTestId('purpose-menu').click();
    await page.getByTestId('purpose-fulfill').click();
    const fulfill = page.getByRole('dialog', { name: /als erfüllt kennzeichnen\?$/ });
    await expect(fulfill).toContainText('200,00 €');
    await fulfill.getByRole('button', { name: 'Trotzdem als erfüllt kennzeichnen' }).click();
    await expect(row(page, 'Tierarztfonds E2E')).toContainText('erfüllt, 200,00 € Rest');

    // 4. Wieder öffnen verlangt eine Begründung.
    await page.getByTestId('purpose-menu').click();
    await page.getByTestId('purpose-reopen').click();
    await expect(page.getByTestId('reopen-save')).toBeDisabled();
    await page.locator('#purpose-reopen-reason').fill('Weitere Behandlungen zugesagt');
    await page.getByTestId('reopen-save').click();
    await expect(row(page, 'Tierarztfonds E2E')).toContainText('aktiv');
    await expect(row(page, 'Tierarztfonds E2E')).not.toContainText('Rest');
  });

  test('Freigaben auf 390 px: mit gewählter Umwidmung steht das Detail, nicht die Schlange (K9-Befund 12)', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const purpose = await callTool<{ id: string }>(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Telefonfonds E2E' } });
    const doc = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'protokoll.pdf', typeKey: 'minutes', subject: 'Protokoll Telefon E2E', documentDate: story('2026-01-15'), contentBase64: PDF.buffer.toString('base64') });
    const transfer = await callTool<{ id: string }>(client, 'finance_purpose_transfer_request', {
      fromPurposeId: null,
      toPurposeId: purpose.id,
      amountCents: 5000,
      transferDate: associationDay(0),
      reason: 'Probe auf dem Telefon',
      documentId: doc.id,
    });
    await switchToJonas(page);
    await page.setViewportSize(PHONE);
    // Wie `?claim=`/`?payment=`: Nach der Wahl zeigt das Telefon das Detail mit dem Weg zurück, die Schlange ist weg.
    await page.goto(`/finance/approvals?transfer=${transfer.id}`);
    await expect(page.getByTestId('purpose-transfer-detail')).toBeVisible();
    await expect(page.getByTestId('approval-queue')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Zur Warteschlange' })).toBeVisible();
  });

  test('nur mit finance.overview: Zweck, Ziel, Bestand und Zustand — keine Bewegungen, die Zeile öffnet nichts', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Überblick E2E', targetCents: 10000, description: 'Zusage von Frau Beispiel', referenceNote: 'Brief vom Januar' } });
    const role = await callTool<{ id: string }>(client, 'roles_create', { name: 'Nur Überblick E2E' });
    await callTool(client, 'roles_set_permissions', { roleId: role.id, permissionKeys: ['finance.overview'] });
    const users = await callTool<{ id: string; email: string }[]>(client, 'users_list', {});
    await callTool(client, 'roles_assign', { userId: users.find((u) => u.email === 'peter@kompass.local')!.id, roleId: role.id });

    await switchTo(page, 'Peter Lang', 'peter@kompass.local');
    await page.goto('/finance/purposes');
    await expect(row(page, 'Überblick E2E')).toContainText('100,00 €');
    await expect(page.getByTestId('purposes-table')).not.toContainText('Vortrag');
    await expect(page.getByTestId('purposes-table')).not.toContainText('Brief vom Januar');
    await expect(page.getByTestId('purposes-transfer-trigger')).toHaveCount(0);
    await row(page, 'Überblick E2E').click();
    await expect(page.getByTestId('purpose-detail')).toHaveCount(0);
  });
  test('E3: Ziel „x von y“, Ausland als Kennzeichen am Namen, Umwidmungen als Spalte, Bewegungen mit Buchung, Text und Name', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Zielzweck E2E', targetCents: 300000 } });
    await page.goto('/finance/purposes');
    const table = page.getByTestId('purposes-table');
    await expect(table.getByRole('columnheader', { name: 'Ausland' })).toHaveCount(0);
    await expect(table.getByRole('columnheader', { name: 'Umwidmungen' })).toBeVisible();
    await expect(row(page, 'Zielzweck E2E').getByTestId('limit-progress')).toContainText('0,00 € von 3.000,00 €');

    const abroad = row(page, 'Partnerprojekt Ausland');
    await expect(abroad.getByTestId('purpose-abroad')).toHaveText('Ausland');
    await abroad.getByRole('button', { name: 'Partnerprojekt Ausland' }).click();
    const movements = page.getByTestId('purpose-movements');
    await expect(movements.getByRole('columnheader')).toHaveText(['Datum', 'Buchung', 'Text', 'Spender/Empfänger', 'Betrag', 'Stand']);
    const line = movements.getByRole('row').filter({ hasText: 'Auszahlung Spendenplattform' }).filter({ hasText: 'Wagner' });
    await expect(line).toHaveCount(1);
    await expect(line.getByRole('link')).toHaveAttribute('href', /\/finance\/entries\/[0-9A-Z]+$/);
  });
  test('E5 auf 390 px: eine Spalte, Dokument Pflicht mit Satz, Ablehnung als Notice über der klebenden Fußleiste, per Tastatur', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/finance/purposes/transfer');
    const form = page.getByTestId('transfer-form');
    await expect(form).toContainText('Pflicht — ohne Beleg für die Entscheidung keine Umwidmung.');
    // Eine Spalte: „nach“ steht unter „von“, nicht daneben.
    const from = await form.locator('#transfer-from').boundingBox();
    const to = await form.locator('#transfer-to').boundingBox();
    expect(to!.y).toBeGreaterThan(from!.y + from!.height);
    // Am Telefon klebt die Leiste nicht, sie steht am Ende der Karte (Designer 2026-10-08, Befund 39).
    await expect(page.getByTestId('transfer-footer')).toHaveCSS('position', 'static');

    // Per Tastatur: von → nach → Betrag → Datum → Begründung, dann absenden ohne Dokument.
    await form.locator('#transfer-from').focus();
    await page.keyboard.press('Tab');
    await expect(form.locator('#transfer-to')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.locator('#transfer-amount')).toBeFocused();
    await page.keyboard.type('50,00');
    await page.keyboard.press('Tab');
    await expect(form.locator('#transfer-date')).toBeFocused();
    await form.locator('#transfer-reason').focus();
    await page.keyboard.type('Rest in die freien Mittel');
    await form.locator('#transfer-from').selectOption({ index: 1 });
    await page.getByTestId('transfer-save').focus();
    await page.keyboard.press('Enter');
    const refusal = page.getByTestId('transfer-footer');
    await expect(refusal.getByRole('alert')).toContainText('Das Dokument fehlt');
    await expect(page.getByTestId('transfer-save')).toHaveText('Zur Freigabe geben');
  });
});
