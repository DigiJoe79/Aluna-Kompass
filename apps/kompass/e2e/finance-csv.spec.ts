import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F4b — CSV-Format einrichten (B3, HANDOFF § 12.3) und CSV-Auszüge laden.
 * Die Dateien entstehen im Test (erfunden, IBANs mit BLZ 99999999); jedes
 * Konto, das ein Test braucht, legt er selbst an — so hängt nichts an einem
 * anderen Test oder am Format des Seed-Kontos.
 */
const BANK_CSV = [
  'Buchungstag;Empfänger;Verwendungszweck;Betrag;Saldo',
  '02.03.2026;Erika Beispiel;Spende März;50,00;1.050,00',
  '05.03.2026;Druckerei Muster;Flyer;-20,00;1.030,00',
].join('\n');

const csvFile = (content = BANK_CSV, name = 'hausbank-maerz.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') });

async function createBankAccount(page: Page, name: string, iban: string): Promise<void> {
  await page.goto('/admin/finance?panel=accounts');
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('IBAN').fill(iban);
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Konto angelegt.')).toBeVisible();
}

/** Bis Schritt 2: Konto wählen, CAMT-Empfehlung überspringen, Datei wählen. */
async function startAssistant(page: Page, account: string, file = csvFile()): Promise<void> {
  await page.goto('/finance/imports/format');
  await page.getByLabel('Konto', { exact: true }).selectOption({ label: account });
  await page.getByRole('button', { name: 'Trotzdem CSV einrichten' }).click();
  await page.getByTestId('csv-file-input').setInputFiles(file);
  await expect(page.getByRole('heading', { name: 'Erkannte Einstellungen' })).toBeVisible();
}

test.describe('finance csv', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Schritt 1 empfiehlt CAMT, bevor er CSV einrichtet', async ({ page }) => {
    await page.goto('/finance/imports/format');
    await expect(page.getByRole('heading', { name: 'Bietet Ihre Bank CAMT.053 an? Dann nehmen Sie das.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wie Sie den Auszug bei der Bank holen' })).toBeVisible();
    await expect(page.getByTestId('csv-file-input')).toHaveCount(0);
    await page.getByRole('button', { name: 'Trotzdem CSV einrichten' }).click();
    await expect(page.getByTestId('csv-file-input')).toHaveCount(1);
  });

  test('die Spaltenauswahl steht über der Vorschau; eine ignorierte Spalte ist als ignoriert markiert', async ({ page }) => {
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await startAssistant(page, 'Hausbank CSV-Test');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('heading', { name: 'Welche Spalte ist was?' })).toBeVisible();
    const table = page.getByTestId('csv-preview');
    await expect(table.getByRole('row')).toHaveCount(3);
    const purposeRole = page.getByLabel('Rolle der Spalte „Verwendungszweck“');
    await expect(purposeRole).toHaveValue('purpose');
    await purposeRole.selectOption('ignore');
    await expect(table.locator('[data-column="Verwendungszweck"][data-ignored="true"]').first()).toBeVisible();
    // Ohne Datum geht es nicht weiter, und der Grund steht da.
    await page.getByLabel('Rolle der Spalte „Buchungstag“').selectOption('ignore');
    await expect(page.getByText('Wählen Sie die Spalte mit dem Buchungstag.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Weiter' })).toBeDisabled();
  });

  test('die Vorzeichenfrage steht an einer echten Zeile der Datei', async ({ page }) => {
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await startAssistant(page, 'Hausbank CSV-Test');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByText(/50,00 €.*Erika Beispiel.*Ist das eine Ausgabe\?/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    await page.getByRole('button', { name: 'Nein, Geld kam herein' }).click();
    await expect(page.getByRole('button', { name: 'Weiter' })).toBeEnabled();
  });

  test('Schritt 5 zeigt die erste Zeile als fertigen Kontoumsatz; Speichern und Laden legt einen Lauf mit dem Formatnamen an', async ({ page }) => {
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await startAssistant(page, 'Hausbank CSV-Test');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nein, Geld kam herein' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();

    const probe = page.getByTestId('csv-probe');
    await expect(probe.getByText('02.03.2026')).toBeVisible();
    await expect(probe.getByText('Erika Beispiel')).toBeVisible();
    await expect(probe.getByText('Spende März')).toBeVisible();
    await expect(probe.getByText('50,00 €')).toBeVisible();
    await expect(page.getByLabel('Name des Formats')).toHaveValue('Hausbank CSV-Test CSV');
    await page.getByLabel('Name des Formats').fill('Hausbank März-Format');
    await page.getByRole('button', { name: 'Speichern und Auszug laden' }).click();

    await expect(page).toHaveURL(/\/finance\/imports$/);
    const run = page.getByTestId('import-run').filter({ hasText: 'Hausbank CSV-Test' });
    await expect(run).toContainText('Hausbank März-Format');
    await expect(run).toContainText('2026-03-02 – 2026-03-05');
  });

  test('ein Neuladen mitten im Assistenten macht nach erneuter Dateiwahl beim gespeicherten Schritt weiter — auch ohne crypto.subtle', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }));
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await startAssistant(page, 'Hausbank CSV-Test');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('heading', { name: 'Vorzeichen' })).toBeVisible();

    await page.reload();
    await page.getByLabel('Konto', { exact: true }).selectOption({ label: 'Hausbank CSV-Test' });
    await page.getByRole('button', { name: 'Trotzdem CSV einrichten' }).click();
    await page.getByTestId('csv-file-input').setInputFiles(csvFile());
    await expect(page.getByRole('heading', { name: 'Vorzeichen' })).toBeVisible();
  });

  test('ein Konto mit CAMT verlangt beim Speichern den Wechsel-Dialog mit dem Hinweis auf mehr Zweifelsfälle', async ({ page }) => {
    await startAssistant(page, 'Vereinskonto');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nein, Geld kam herein' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nur speichern' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Auszugsformat wechseln?' });
    await expect(dialog.getByText('Nach dem Wechsel erkennt Kompass schon geladene Zahlungen nicht mehr sicher wieder und legt Ihnen mehr Zweifelsfälle vor.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Wechsel bestätigen' }).click();
    await expect(page).toHaveURL(/\/finance\/imports$/);
    await expect(page.getByText('CSV-Format gespeichert.')).toBeVisible();
  });

  test('ohne finance.setup steht dort, wer das Format einrichten kann', async ({ page }) => {
    // „Ines Brandt“ (Finanz-Seed): finance.read und finance.entriesFinalize, kein finance.setup.
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Ines Brandt/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('ines@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('ines-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('ines-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/finance/imports/format');
    await expect(page.getByText('nicht möglich')).toBeVisible();
    await expect(page.getByText(/Anna Berger/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trotzdem CSV einrichten' })).toHaveCount(0);
  });
});
