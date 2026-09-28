import path from 'node:path';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { callTool, mcpClient, PDF, PHONE } from './expense-helpers';
import { loginAsAdmin, resetDatabase } from './helpers';

/** > 1 MB (N9, Befundliste 0.2.0) — derselbe erfundene Beleg wie bei den Auslagen. */
const BIG_PDF = path.resolve(import.meta.dirname, 'fixtures/beleg-1500k.pdf');

/**
 * F8b Task 6b — Finanzen → Zurückgelegtes Geld (E4, HANDOFF 14.3 Punkte 6
 * und 7): ein Vorgang ändert den Bestand der Rücklage, nie ein Bankkonto
 * oder eine Kasse; der Höchstbetrag trägt ein Zustandswort; ein Vorgang in
 * der Zukunft wird mit Grund abgelehnt.
 */
test.describe('finance reserves (F8b)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('zuführen mit Beschluss-Upload über 1 MB: Bestand steigt, Bankkonten und Kassen bleiben, Höchstbetrag mit Zustandswort, Zukunft abgelehnt', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const doc = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'protokoll.pdf', typeKey: 'minutes', subject: 'Protokoll Rücklage E2E', documentDate: '2026-01-15', contentBase64: PDF.buffer.toString('base64') });
    await callTool(client, 'finance_reserve_save', { kind: 'free', name: 'Freie Rücklage E2E', resolutionDocumentId: doc.id });
    const balancesBefore = await callTool<{ accounts: unknown }>(client, 'finance_balances', {});

    await page.goto('/finance/reserves');
    await expect(page.getByText('Eine Rücklage ist ein Beschluss, kein Konto')).toBeVisible();
    const row = page.getByTestId('reserve-row').filter({ hasText: 'Freie Rücklage E2E' });
    await expect(row).toContainText('freie Rücklage');
    await row.getByTestId('reserve-movement-trigger').click();
    const dialog = page.getByTestId('movement-dialog');
    await expect(dialog.locator('#movement-for-year')).toBeVisible();
    // Weit über jedem Höchstbetrag der Entwicklungsdaten: Befund S fragt nach einer Begründung, sperrt aber nicht.
    await dialog.locator('#movement-amount').fill('1000000,00');
    await page.getByTestId('movement-resolution-upload').setInputFiles(BIG_PDF);
    await expect(page.getByTestId('movement-after')).toHaveText('Danach: Bestand 1.000.000,00 €. Auf den Bankkonten und Kassen ändert sich nichts.');
    await page.getByTestId('movement-save').click();
    const capReason = dialog.getByTestId('movement-cap-reason');
    await expect(capReason).toContainText('über dem Höchstbetrag');
    await capReason.getByLabel('Begründung über dem Höchstbetrag').fill('Rücklage für den Neubau, Beschluss der Mitgliederversammlung');
    await page.getByTestId('movement-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByTestId('reserve-balance')).toHaveText('1.000.000,00 €');
    await expect(page.getByTestId('reserve-cap-over')).toContainText('über dem Höchstbetrag');

    // Punkt 6: kein Bankkonto, keine Kasse bewegt.
    const balancesAfter = await callTool<{ accounts: unknown }>(client, 'finance_balances', {});
    expect(balancesAfter.accounts).toEqual(balancesBefore.accounts);

    // Punkt 7: der Höchstbetrag trägt ein Zustandswort.
    await expect(page.getByTestId('reserve-cap').getByTestId('limit-progress')).toHaveAttribute('data-state', /calm|near|exceeded/);
    await expect(page.getByTestId('reserve-cap')).toContainText(/ruhig|nähert sich|überschritten/);
    await expect(page.getByTestId('reserve-cap')).toContainText('Näherung');

    // Ein Vorgang in der Zukunft wird mit Grund abgelehnt.
    const tomorrow = associationDay(1);
    await row.getByTestId('reserve-movement-trigger').click();
    await page.getByTestId('movement-kind-withdraw').click();
    await dialog.locator('#movement-date').fill(tomorrow);
    await dialog.locator('#movement-amount').fill('10,00');
    await page.getByTestId('movement-resolution-upload').setInputFiles({ name: 'protokoll.pdf', mimeType: 'application/pdf', buffer: PDF.buffer });
    await page.getByTestId('movement-save').click();
    await expect(page.getByTestId('movement-error')).toContainText('liegt nach heute');
  });
  test('Stammsatz im UI (Befund 40): Beschluss mit Nummer, Art-Info per Tastatur, bearbeiten, Vortrag, Beschluss ersetzen, stilllegen, löschen', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const doc = await callTool<{ id: string; number: string }>(client, 'dms_receive', { filename: 'protokoll.pdf', typeKey: 'minutes', subject: 'Protokoll Rücklagenbeschluss', documentDate: '2026-01-15', contentBase64: PDF.buffer.toString('base64') });
    await callTool(client, 'finance_reserve_save', { kind: 'free', name: 'Stammsatz E2E', resolutionDocumentId: doc.id });
    await callTool(client, 'finance_reserve_save', { kind: 'free', name: 'Löschbar E2E', resolutionDocumentId: doc.id });

    await page.goto('/finance/reserves');
    const row = page.getByTestId('reserve-row').filter({ hasText: 'Stammsatz E2E' });
    // Beschluss mit Nummer, Betreff und Datum statt „Beschluss öffnen“.
    await expect(row.getByTestId('reserve-resolution')).toHaveText(`${doc.number} · Protokoll Rücklagenbeschluss · 15.01.2026`);

    // § 62 AO als Infoknopf: per Tastatur erreichbar, kein title-Attribut.
    const info = row.getByTestId('reserve-kind-info');
    await info.focus();
    await page.keyboard.press('Enter');
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(row.getByText('§ 62 Abs. 1 Nr. 3 AO')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.getByText('§ 62 Abs. 1 Nr. 3 AO')).toBeHidden();

    // Bearbeiten.
    await row.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    await page.getByTestId('reserve-form').locator('#reserve-name').fill('Stammsatz E2E geändert');
    await page.getByTestId('reserve-form-save').click();
    const renamed = page.getByTestId('reserve-row').filter({ hasText: 'Stammsatz E2E geändert' });
    await expect(renamed).toBeVisible();

    // Vortrag erfassen: Betrag, Stichtag, Beschluss zusammen.
    const year = associationDay(0).slice(0, 4);
    await renamed.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Vortrag erfassen' }).click();
    const cf = page.getByTestId('carry-forward-dialog');
    await cf.locator('#carry-forward-amount').fill('250,00');
    await cf.locator('#carry-forward-date').fill(`${year}-01-01`);
    await page.getByTestId('carry-forward-resolution-upload').setInputFiles({ name: 'vortrag.pdf', mimeType: 'application/pdf', buffer: PDF.buffer });
    await page.getByTestId('carry-forward-save').click();
    await expect(cf).toHaveCount(0);
    await expect(renamed.getByTestId('reserve-balance')).toHaveText('250,00 €');
    await expect(renamed).toContainText('Vortrag 250,00 € zum 01.01.');

    // Beschluss ersetzen.
    await renamed.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Beschluss ersetzen' }).click();
    await page.getByTestId('replace-resolution-upload').setInputFiles({ name: 'neu.pdf', mimeType: 'application/pdf', buffer: PDF.buffer });
    await page.getByTestId('replace-resolution-save').click();
    await expect(renamed.getByTestId('reserve-resolution')).not.toContainText(doc.number);

    // Löschen geht nicht mit Vortrag — der Grund steht da.
    await renamed.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Löschen …' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByText('Zu diesem zurückgelegten Geld gibt es schon Vorgänge oder einen Vortrag.')).toBeVisible();

    // Stilllegen und wieder aktivieren.
    await renamed.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Stilllegen' }).click();
    await expect(renamed).toContainText('stillgelegt');
    await renamed.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Wieder aktivieren' }).click();
    await expect(renamed).not.toContainText('stillgelegt');

    // Ohne Vorgang und Vortrag: löschen.
    const deletable = page.getByTestId('reserve-row').filter({ hasText: 'Löschbar E2E' });
    await deletable.getByTestId('reserve-menu').click();
    await page.getByRole('menuitem', { name: 'Löschen …' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(deletable).toHaveCount(0);

    // 390 px: das Zeilenmenü bleibt erreichbar.
    await page.setViewportSize(PHONE);
    await renamed.getByTestId('reserve-menu').scrollIntoViewIfNeeded();
    await renamed.getByTestId('reserve-menu').click();
    await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  });

  test('Segment im Vorgang-Dialog folgt den Pfeiltasten', async ({ page }) => {
    await page.goto('/finance/reserves');
    const row = page.getByTestId('reserve-row').filter({ hasText: 'Projektmittel Dach' });
    await row.getByTestId('reserve-movement-trigger').click();
    const allocate = page.getByTestId('movement-kind-allocate');
    await expect(allocate).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('movement-kind-withdraw')).toHaveAttribute('tabindex', '-1');
    await allocate.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('movement-kind-withdraw')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('movement-kind-withdraw')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('movement-kind-dissolve')).toHaveAttribute('aria-checked', 'true');
  });
});
