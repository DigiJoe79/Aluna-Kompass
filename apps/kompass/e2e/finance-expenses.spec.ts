import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * F8a Task 5 — D1 „Auslage einreichen“ (`/finance/expenses/new`), 390 px
 * zuerst. Der Seed bringt Aufwandsspenden eingeschaltet, einen Kilometersatz
 * von 0,25 € ab dem 1. Januar des laufenden Jahres und Jonas Feld mit
 * `finance.approve`. Die Verwaltung (Anna Berger) ist mit keinem Kontakt
 * verknüpft — den Sperrzustand zeigt sie so, wie sie ist; für alles andere
 * verknüpft sie ihr Konto einmal selbst mit Tomas Leitner.
 */

const PHONE = { width: 390, height: 844 };
const IBAN = 'DE93999999990000000001';
const PDF = { name: 'rechnung.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') };

async function linkOwnContact(page: Page): Promise<void> {
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: /Anna Berger/ });
  await row.getByRole('button', { name: 'Verknüpfen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Kontakt wählen' }).click();
  await page.getByTestId('contact-option').filter({ hasText: 'Tomas Leitner' }).click();
  await dialog.getByRole('button', { name: 'Verknüpfen' }).click();
  await expect(page.getByRole('row', { name: /Anna Berger/ }).getByRole('link', { name: 'Tomas Leitner' })).toBeVisible();
}

const card = (page: Page, n: number) => page.getByTestId('expense-position').nth(n - 1);
const footer = (page: Page) => page.getByTestId('expense-footer');

async function openForm(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto('/finance/expenses/new');
  await expect(page.getByRole('heading', { name: 'Auslage einreichen' })).toBeVisible();
}

async function fillReceipt(page: Page, n: number, amount: string, purpose: string): Promise<void> {
  await card(page, n).getByLabel('Betrag').fill(amount);
  await card(page, n).getByLabel('Wofür war das?').fill(purpose);
}

/** Gesichert, und nichts Getipptes wartet mehr auf die nächste Sicherung. */
async function saved(page: Page): Promise<void> {
  const status = footer(page).getByTestId('save-status');
  await expect(status).toHaveAttribute('data-pending', 'false');
  await expect(status).toContainText(/Zwischenstand gespeichert · \d{2}:\d{2}/);
}

test.describe('finance expenses — einreichen (D1)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('eine Auslage mit Beleg und Fahrt wird laufend gesichert und eingereicht; die Bestätigung nennt Nummer und Freigeber', async ({ page }) => {
    await linkOwnContact(page);
    await openForm(page);
    await expect(page.getByTestId('expense-for-whom')).toContainText('Tomas Leitner');

    await fillReceipt(page, 1, '19,99', 'Futter für die Pflegestelle');
    await card(page, 1).getByTestId('receipt-file-input').setInputFiles(PDF);
    await expect(card(page, 1).getByTestId('receipt-file')).toContainText('rechnung.pdf');
    await expect(card(page, 1).getByRole('button', { name: 'ersetzen' })).toBeVisible();
    await expect(card(page, 1).getByTestId('scan-guide')).toHaveCount(0);

    await page.getByRole('button', { name: 'Weitere Position' }).click();
    await expect(card(page, 2).getByRole('radio', { name: 'Beleg' })).toBeFocused();
    await card(page, 2).getByRole('radio', { name: 'Fahrt' }).click();
    await card(page, 2).getByLabel('Von').fill('Musterstadt');
    await card(page, 2).getByLabel('Nach').fill('Beispielstadt');
    await card(page, 2).getByLabel('Anlass').fill('Pflegestelle besuchen');
    await card(page, 2).getByLabel('Kilometer').fill('84');
    await expect(card(page, 2).getByTestId('trip-calculation')).toHaveText('84 km × 0,25 € = 21,00 €');
    await expect(page.getByTestId('expense-total')).toContainText('40,99 €');

    await page.getByLabel('IBAN').fill(IBAN);
    await saved(page);

    // Am Server gesichert: Neu laden holt den Entwurf zurück — mit Beleg und Fahrt.
    await expect(page).toHaveURL(/\/finance\/expenses\/new\?id=/);
    await page.reload();
    await expect(card(page, 1).getByLabel('Wofür war das?')).toHaveValue('Futter für die Pflegestelle');
    await expect(card(page, 1).getByTestId('receipt-file')).toBeVisible();
    await expect(card(page, 2).getByLabel('Kilometer')).toHaveValue('84');
    // Die IBAN steht jetzt als feste Zeile mit „andere IBAN“ — vorbelegt, nicht mehr zu tippen.
    await expect(page.getByTestId('iban-fixed')).toHaveText('DE93 9999 9999 0000 0000 01');
    await expect(page.getByRole('button', { name: 'andere IBAN' })).toBeVisible();

    await footer(page).getByRole('button', { name: 'Einreichen' }).click();
    const done = page.getByTestId('expense-submitted');
    await expect(done.getByRole('heading', { name: 'Eingereicht' })).toBeVisible();
    await expect(done).toContainText(/KE-\d{4}-\d{3}/);
    await expect(done).toContainText('40,99 €');
    await expect(done).toContainText('Futter für die Pflegestelle');
    await expect(done.getByTestId('approver-names')).toContainText('Jonas Feld');
    await expect(done.getByTestId('approver-names')).not.toContainText('Anna Berger');
    await expect(done.getByRole('link', { name: 'Zu meinen Anträgen' })).toHaveAttribute('href', '/finance/expenses');
    await expect(done.getByRole('link', { name: 'Weitere Auslage einreichen' })).toHaveAttribute('href', '/finance/expenses/new');
  });

  test('Einreichen ohne Beleg zeigt die Ablehnung mit Auswegen über den Knöpfen, die Eingaben bleiben', async ({ page }) => {
    await linkOwnContact(page);
    await openForm(page);
    await fillReceipt(page, 1, '12,50', 'Briefmarken');
    await page.getByLabel('IBAN').fill(IBAN);

    const submit = footer(page).getByRole('button', { name: 'Einreichen' });
    await expect(submit).toBeEnabled();
    await submit.click();
    const refusal = footer(page).getByRole('alert');
    await expect(refusal).toContainText('Position 1 fehlt noch der Beleg.');
    await expect(refusal.getByRole('button', { name: 'Als Entwurf behalten' })).toBeVisible();
    await expect(card(page, 1).getByLabel('Betrag')).toHaveValue('12,50');
    await expect(card(page, 1).getByLabel('Wofür war das?')).toHaveValue('Briefmarken');

    await refusal.getByRole('button', { name: 'PDF für Position 1 wählen' }).click();
    await expect(card(page, 1).getByRole('button', { name: 'PDF wählen' })).toBeFocused();
  });

  test('ein Foto wird am Feld abgelehnt und nennt die Datei; die Eingaben bleiben', async ({ page }) => {
    await linkOwnContact(page);
    await openForm(page);
    await fillReceipt(page, 1, '8,00', 'Kopien');
    await expect(card(page, 1).getByRole('button', { name: 'PDF wählen' })).toBeVisible();
    await expect(card(page, 1).getByTestId('receipt-file-input')).toHaveAttribute('accept', 'application/pdf');
    await expect(card(page, 1).getByTestId('receipt-file-input')).not.toHaveAttribute('capture');

    await card(page, 1).getByTestId('receipt-file-input').setInputFiles({ name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) });
    const alert = card(page, 1).getByRole('alert');
    await expect(alert).toContainText('Das ist ein Foto. Kompass nimmt nur PDF.');
    await expect(alert).toContainText('IMG_0042.jpg');
    await expect(alert).toContainText('Ihre Eingaben bleiben stehen.');
    await expect(card(page, 1).getByTestId('scan-guide')).toBeVisible();
    await expect(card(page, 1).getByLabel('Betrag')).toHaveValue('8,00');
    await expect(card(page, 1).getByLabel('Wofür war das?')).toHaveValue('Kopien');
  });

  test('eine zu große Datei wird am Feld abgelehnt und nennt die Grenze', async ({ page }) => {
    await linkOwnContact(page);
    await openForm(page);
    await card(page, 1).getByTestId('receipt-file-input').setInputFiles({ name: 'scan-gross.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25) });
    const alert = card(page, 1).getByRole('alert');
    await expect(alert).toContainText('Die Datei ist zu groß.');
    await expect(alert).toContainText('scan-gross.pdf');
    await expect(alert).toContainText('10 MB');
    await expect(alert).toContainText('Ihre Eingaben bleiben stehen.');
  });

  test('ohne Kontaktverknüpfung erscheint der Sperrzustand mit dem, wer es erledigen kann', async ({ page }) => {
    await openForm(page);
    await expect(page.getByText('nicht möglich')).toBeVisible();
    const reason = page.getByText('Ihr Nutzerkonto ist mit keinem Kontakt verknüpft');
    await expect(reason).toBeVisible();
    await expect(reason).toContainText('Anna Berger');
    await expect(page.getByTestId('expense-position')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Einreichen' })).toHaveCount(0);
  });

  test('Verzicht blendet die IBAN aus und erscheint nur bei eingeschalteten Aufwandsspenden', async ({ page }) => {
    await linkOwnContact(page);
    await openForm(page);
    await expect(page.getByLabel('IBAN')).toBeVisible();
    const waiver = page.getByRole('switch', { name: 'Auf die Erstattung verzichten' });
    await expect(page.getByText('Statt Geld bekommen Sie eine Zuwendungsbestätigung über den Betrag.')).toBeVisible();
    await waiver.click();
    await expect(page.getByLabel('IBAN')).toHaveCount(0);
    await waiver.click();
    await expect(page.getByLabel('IBAN')).toBeVisible();

    await setE2ESetting(page, 'finance.expenseWaiversEnabled', false);
    await page.goto('/finance/expenses/new');
    await expect(page.getByRole('heading', { name: 'Auslage einreichen' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Auf die Erstattung verzichten' })).toHaveCount(0);
    await expect(page.getByLabel('IBAN')).toBeVisible();
  });
});

test.describe('finance expenses — Telefon mit Touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('Felder sind auf dem Telefon 46 px hoch', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await linkOwnContact(page);
    await page.goto('/finance/expenses/new');
    const amount = card(page, 1).getByLabel('Betrag');
    await expect(amount).toBeVisible();
    await expect(card(page, 1).getByLabel('Wofür war das?')).toHaveCSS('height', '46px');
    await expect(amount).toHaveCSS('font-size', '16px');
    await expect(footer(page).getByRole('button', { name: 'Einreichen' })).toHaveCSS('height', '46px');
  });
});
