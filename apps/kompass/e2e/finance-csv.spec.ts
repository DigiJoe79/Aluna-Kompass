import path from 'node:path';
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

/** Kopien der Bauhelfer-Ausgabe (`packages/modules/finance/src/import/csv-fixture.ts`), Byte für Byte geprüft. */
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/csv');

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
async function startAssistant(page: Page, account: string, file: ReturnType<typeof csvFile> | string = csvFile()): Promise<void> {
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
    await expect(run).toContainText('02.03.2026 – 05.03.2026');
    await expect(run).not.toContainText(/\d{4}-\d{2}-\d{2}/);
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

  test('die Ablagefläche nimmt CAMT oder CSV an, ohne Format-Wähler', async ({ page }) => {
    await page.goto('/finance/imports');
    await expect(page.getByText('Kontoauszug hierher ziehen (CAMT oder CSV, auch mehrere)')).toBeVisible();
    await expect(page.getByTestId('statement-file-input')).toHaveAttribute('accept', /\.csv/);
    await expect(page.getByLabel(/Format/)).toHaveCount(0);
  });

  test('eine CSV auf ein Konto ohne CSV-Format führt über „CSV-Format einrichten“ in den Assistenten für dieses Konto', async ({ page }) => {
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await page.goto('/finance/imports');
    await page.getByLabel('Konto', { exact: true }).selectOption({ label: 'Hausbank CSV-Test' });
    await page.getByTestId('statement-file-input').setInputFiles(csvFile());
    await expect(page.getByText('Für Hausbank CSV-Test ist noch kein CSV-Format eingerichtet.')).toBeVisible();
    await page.getByRole('button', { name: 'CSV-Format einrichten' }).click();
    await expect(page).toHaveURL(/\/finance\/imports\/format\?account=/);
    await expect(page.getByLabel('Konto', { exact: true })).toHaveValue(new URL(page.url()).searchParams.get('account')!);
    await expect(page.getByLabel('Konto', { exact: true }).locator('option:checked')).toHaveText('Hausbank CSV-Test');
  });

  test('eine CSV mit fremder Kopfzeile bietet die gewohnte Datei oder ein neues Format an und legt keinen Lauf an', async ({ page }) => {
    await page.goto('/finance/imports');
    await page.getByLabel('Konto', { exact: true }).selectOption({ label: 'Spendenplattform' });
    const before = await page.getByTestId('import-run').count();
    await page.getByTestId('statement-file-input').setInputFiles(csvFile());
    await expect(page.getByText(/passt nicht zum CSV-Format von Spendenplattform \(Spendenplattform CSV\)/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Datei im gewohnten Format holen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neues CSV-Format einrichten' })).toBeVisible();
    await expect(page.getByTestId('import-run')).toHaveCount(before);
  });

  test('ein CSV-Auszug ohne Saldospalte lädt ohne Rückfrage und steht als „ohne Kontostand“ in der Liste', async ({ page }) => {
    const noBalance = ['Buchungstag;Empfänger;Verwendungszweck;Betrag', '02.03.2026;Erika Beispiel;Spende März;50,00', '05.03.2026;Druckerei Muster;Flyer;-20,00'].join('\n');
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await startAssistant(page, 'Hausbank CSV-Test', csvFile(noBalance, 'ohne-saldo.csv'));
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nein, Geld kam herein' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nur speichern' }).click();
    await expect(page).toHaveURL(/\/finance\/imports$/);

    await page.getByLabel('Konto', { exact: true }).selectOption({ label: 'Hausbank CSV-Test' });
    await page.getByTestId('statement-file-input').setInputFiles(csvFile(noBalance, 'ohne-saldo.csv'));
    await expect(page.getByText(/ohne-saldo\.csv: 2 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    const run = page.getByTestId('import-run').filter({ hasText: 'Hausbank CSV-Test' });
    await expect(run).toContainText('ohne Kontostand');
  });

  test('die Checkliste nennt Konten ohne Auszugsformat und führt in den Assistenten', async ({ page }) => {
    await createBankAccount(page, 'Hausbank CSV-Test', 'DE66999999990000303030');
    await page.goto('/admin/finance?panel=checklist');
    const step = page.getByTestId('requirement-importFormat');
    await expect(step).toHaveAttribute('data-done', 'false');
    await expect(step).toContainText('1 Konto ohne Auszugsformat');
    await step.getByRole('link').click();
    await expect(page).toHaveURL(/\/finance\/imports\/format$/);
    await expect(page.getByRole('heading', { name: 'Bietet Ihre Bank CAMT.053 an? Dann nehmen Sie das.' })).toBeVisible();
  });

  test('Windows-Zeichensatz, Vorspann und getrennte Spalten für Aus- und Eingang erkennt der Assistent ohne Handarbeit', async ({ page }) => {
    await createBankAccount(page, 'Drittbank CSV-Test', 'DE30999999990000505050');
    await startAssistant(page, 'Drittbank CSV-Test', path.join(FIXTURES, 'zweitbank.csv'));
    await expect(page.getByLabel('Zeichensatz')).toHaveValue('windows-1252');
    await expect(page.getByLabel('Kopfzeile steht in Zeile')).toHaveValue('5');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByLabel('Rolle der Spalte „Soll“')).toHaveValue('debit');
    await expect(page.getByLabel('Rolle der Spalte „Haben“')).toHaveValue('credit');
    await expect(page.getByTestId('csv-preview')).toContainText('Druckerei Müller & Söhne');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Nein, Geld kam herein' }).click();
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByRole('button', { name: 'Speichern und Auszug laden' }).click();
    await expect(page).toHaveURL(/\/finance\/imports$/);
    const run = page.getByTestId('import-run').filter({ hasText: 'Drittbank CSV-Test' });
    await expect(run).toContainText('03.03.2026 – 04.03.2026');
    await expect(run).toContainText('ohne Kontostand');
  });

  test('ein CSV-Auszug ohne Kontostand bekommt ihn nachträglich, und der Lauf zeigt Anfang und Ende', async ({ page }) => {
    // Seed-Konto „Zweitbank CSV“ (F4b): der Auszug hat keine Saldospalte und wurde ohne Kontostand geladen.
    await page.goto('/finance/imports');
    const run = page.getByTestId('import-run').filter({ hasText: 'Zweitbank CSV' });
    await expect(run).toContainText('ohne Kontostand');
    await run.getByRole('button', { name: 'Kontostand nachtragen' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Kontostand laut Bank am 04.03.2026')).toBeVisible();
    await expect(dialog).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await dialog.getByLabel('Kontostand laut Bank am 04.03.2026').fill('1.030,00');
    await dialog.getByRole('button', { name: 'Kontostand übernehmen' }).click();

    await expect(page.getByText('Kontostand nachgetragen.')).toBeVisible();
    await expect(run).not.toContainText('ohne Kontostand');
    await expect(run).toContainText('Ende 1.030,00 €');

    // Ein zweites Nachtragen ist nicht mehr möglich: der Knopf ist verschwunden.
    await expect(run.getByRole('button', { name: 'Kontostand nachtragen' })).toHaveCount(0);
  });
});
