import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { backToAdmin, EXPENSE_IBAN, linkOwnContact, mcpClient, PDF, PHONE, rejectInQueue, submitClaim, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * F8a Task 5 — D1 „Auslage einreichen“ (`/finance/expenses/new`), 390 px
 * zuerst. Der Seed bringt Aufwandsspenden eingeschaltet, einen Kilometersatz
 * von 0,25 € ab dem 1. Januar des laufenden Jahres und Jonas Feld mit
 * `finance.approve`. Die Verwaltung (Anna Berger) ist mit keinem Kontakt
 * verknüpft — den Sperrzustand zeigt sie so, wie sie ist; für alles andere
 * verknüpft sie ihr Konto einmal selbst mit Tomas Leitner.
 */

const IBAN = EXPENSE_IBAN;

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
    await expect(page.getByRole('checkbox', { name: 'Regelmäßige Tätigkeit (gewöhnlich monatlich)' })).toHaveCount(0);
    await waiver.click();
    await expect(page.getByLabel('IBAN')).toHaveCount(0);
    // Nachtrag: die Verzichtsfrist hängt an „regelmäßig“ (3 Monate einmalig, 12 Monate regelmäßig).
    const recurring = page.getByRole('checkbox', { name: 'Regelmäßige Tätigkeit (gewöhnlich monatlich)' });
    await expect(recurring).not.toBeChecked();
    await expect(page.getByText('bei einer einmaligen Auslage 3 Monate, bei einer regelmäßigen Tätigkeit 12 Monate')).toBeVisible();
    await recurring.check();
    await saved(page);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Regelmäßige Tätigkeit (gewöhnlich monatlich)' })).toBeChecked();
    await waiver.click();
    await expect(page.getByLabel('IBAN')).toBeVisible();

    await setE2ESetting(page, 'finance.expenseWaiversEnabled', false);
    await page.goto('/finance/expenses/new');
    await expect(page.getByRole('heading', { name: 'Auslage einreichen' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Auf die Erstattung verzichten' })).toHaveCount(0);
    await expect(page.getByLabel('IBAN')).toBeVisible();
  });
});

test.describe('finance expenses — eigene Anträge (D2)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('eigene Anträge stehen als Karten in Offen und Erledigt mit Satz in Alltagssprache; ein abgelehnter lässt sich neu einreichen', async ({ page, baseURL }) => {
    await linkOwnContact(page);
    await page.setViewportSize(PHONE);
    await page.goto('/finance/expenses');
    await expect(page.getByRole('heading', { name: 'Eigene Anträge', level: 2 })).toBeVisible();
    await expect(page.getByText('Noch kein Antrag')).toBeVisible();
    await expect(page.getByTestId('claims-empty').getByRole('link', { name: 'Auslage einreichen' })).toHaveAttribute('href', '/finance/expenses/new');

    const client = await mcpClient(page, baseURL);
    const waiting = await submitClaim(client, { purpose: 'Briefmarken', amountCents: 1250 });
    const refused = await submitClaim(client, { purpose: 'Druckerpatronen', amountCents: 3000 });
    await submitClaim(client, { purpose: 'Porto', amountCents: 300, submit: false });
    await client.close();

    await switchToJonas(page);
    await rejectInQueue(page, refused.id, 'Beleg ist nicht lesbar.');
    await backToAdmin(page);

    await page.setViewportSize(PHONE);
    await page.goto('/finance/expenses');
    const open = page.getByTestId('claims-open');
    const done = page.getByTestId('claims-done');
    await expect(open.getByRole('heading', { name: 'Offen' })).toBeVisible();
    await expect(open.getByTestId('claim-card')).toHaveCount(2);
    const waitingCard = open.getByTestId('claim-card').filter({ hasText: waiting.number! });
    await expect(waitingCard).toContainText('eingereicht');
    await expect(waitingCard).toContainText('wartet auf Freigabe');
    await expect(waitingCard).toContainText('12,50 €');
    await expect(waitingCard).toContainText('Freigeben kann: Jonas Feld');
    const draftCard = open.getByTestId('claim-card').filter({ hasText: 'Entwurf' });
    await expect(draftCard).toContainText('3,00 €');
    await expect(draftCard).toHaveAttribute('href', /\/finance\/expenses\/new\?id=/);

    const refusedCard = done.getByTestId('claim-card');
    await expect(refusedCard).toHaveCount(1);
    await expect(refusedCard).toContainText(refused.number!);
    await expect(refusedCard).toContainText('abgelehnt');
    await expect(refusedCard).toContainText('Beleg ist nicht lesbar.');
    // Die ganze Karte ist Trefferfläche, mindestens 64 px hoch.
    const box = (await refusedCard.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);

    await refusedCard.click();
    await expect(page).toHaveURL(`/finance/expenses/${refused.id}`);
    const detail = page.getByTestId('claim-detail');
    await expect(detail.getByTestId('claim-amount')).toHaveText('30,00 €');
    await expect(detail.getByTestId('claim-reason')).toContainText('Beleg ist nicht lesbar.');
    await expect(detail.getByTestId('claim-history')).toContainText('Abgelehnt');
    await expect(detail.getByRole('link', { name: 'Beleg öffnen' })).toHaveAttribute('href', new RegExp(`/finance/expenses/${refused.id}/receipt/`));
    const receipt = await page.request.get((await detail.getByRole('link', { name: 'Beleg öffnen' }).getAttribute('href'))!);
    expect(receipt.headers()['content-type']).toBe('application/pdf');

    await detail.getByRole('button', { name: 'Neu einreichen' }).click();
    await expect(page).toHaveURL(/\/finance\/expenses\/new\?id=/);
    await expect(page.getByTestId('expense-copied-from')).toContainText(refused.number!);
    await expect(card(page, 1).getByLabel('Wofür war das?')).toHaveValue('Druckerpatronen');
    await expect(card(page, 1).getByTestId('receipt-file')).toBeVisible();
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
