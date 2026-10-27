import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { callTool, mcpClient } from './expense-helpers';
import { ADMIN, loginAs, loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * Rechenschaft D1b — Kassenprüfung in der Oberfläche. Seed: Die Prüfung des Vorjahres ist abgeschlossen (Bericht
 * abgelegt), Mira Klein prüft in Kompass, Holger Brandt auf Papier. Für eine laufende Prüfung öffnet der Test das Jahr
 * wieder und schließt es erneut (Nachprüfung offen) — über die Werkzeuge, weil Jahresabschluss und Wiederöffnen hier
 * nicht das Thema sind.
 */
const MIRA = { email: 'mira@kompass.local', password: ADMIN.password };

/** Das Jahr der Kassenprüfung (Vorgabe der Übersicht) über die Seite, dann wieder öffnen und schließen. */
async function reopenAndClose(page: Page, baseURL: string | undefined): Promise<string> {
  await page.goto('/finance/audit');
  const yearId = await page.getByTestId('audit-year').getByRole('combobox', { name: 'Jahr' }).inputValue();
  await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // Wiederöffnen und Abschließen sind humanOnly — hier nur für die Ausgangslage.
  const client = await mcpClient(page, baseURL);
  await callTool(client, 'finance_period_reopen', { id: yearId, note: 'Nachprüfung im Test' });
  await callTool(client, 'finance_period_close', { id: yearId });
  await client.close();
  return yearId;
}

test.describe('finance audit (Rechenschaft D1b)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('Prüferin: von /finance auf die Kassenprüfung, Stichprobe im Journal, Vermerk an der Buchung', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    const yearId = await reopenAndClose(page, baseURL);

    await loginAs(page, MIRA.email, MIRA.password);
    await page.goto('/finance');
    await expect(page).toHaveURL(/\/finance\/audit/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kassenprüfung');
    // Wiederöffnet ohne geänderte Buchung: derselbe Befund wie in Schritt 10 (Designer Runde 5, 260 Telefon).
    await expect(page.getByTestId('audit-head')).toContainText('Der Prüfbericht gilt weiter');

    await page.getByTestId('package-journal').getByRole('link', { name: /Journal/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/finance/audit/journal\\?year=${yearId}`));
    const row = page.locator('tbody tr').filter({ has: page.getByRole('checkbox') }).first();
    const box = row.getByRole('checkbox');
    const before = await box.getAttribute('aria-checked');
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await page.reload();
    await expect(page.locator('tbody tr').filter({ has: page.getByRole('checkbox') }).first().getByRole('checkbox')).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');

    await page.locator('tbody tr').filter({ has: page.getByRole('checkbox') }).first().locator('[data-col="title"] a').click();
    await expect(page).toHaveURL(/\/finance\/entries\/.+from=audit/);
    await expect(page.getByRole('link', { name: '1. Journal' })).toBeVisible();
    await page.getByTestId('remark-write').click();
    const dialog = page.getByTestId('remark-dialog');
    await dialog.getByLabel('Text').fill('Bitte die Rechnung zu dieser Buchung zeigen.');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('audit-remarks-card')).toContainText('Bitte die Rechnung zu dieser Buchung zeigen.');
  });

  test('Schatzmeisterin: Vermerk zum Jahr beantworten, Kasse zählen im Beisein der Prüferin', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    await reopenAndClose(page, baseURL);

    await page.goto('/finance/audit');
    const thread = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Vermerke zum Jahr' }) }).last();
    const remark = thread.locator('article').filter({ hasText: 'Wurde die Spendendose im Dezember geleert?' });
    await remark.getByRole('button', { name: 'Antworten' }).click();
    await remark.getByLabel('Antwort').fill('Ja, am 30. Dezember, Protokoll in der Akte.');
    await remark.getByRole('button', { name: 'Antworten' }).click();
    await expect(remark).toContainText('Ja, am 30. Dezember');
    await expect(remark).toContainText('beantwortet');

    await page.goto('/finance/cash');
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).first().click();
    const witnesses = page.getByTestId('count-witnesses');
    await expect(witnesses).toContainText('Im Beisein von');
    await expect(witnesses.getByRole('checkbox', { name: 'Mira Klein' })).toBeVisible();
  });

  test('zuletzt: Zugang von Mira Klein beenden — danach sieht sie die Finanzen nicht mehr', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/audit');
    const row = page.getByTestId('auditor-row').filter({ hasText: 'Mira Klein' });
    await row.getByRole('button', { name: 'Zugang beenden …' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Zugang von Mira Klein beenden');
    await confirm.getByRole('button', { name: 'Zugang beenden' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId('auditor-row').filter({ hasText: 'Mira Klein' })).toContainText('Zugang beendet am');

    await loginAs(page, MIRA.email, MIRA.password);
    await page.goto('/finance');
    await expect(page.getByText('Diese Seite ist für Ihre Rolle nicht freigegeben.')).toBeVisible();
  });
});
