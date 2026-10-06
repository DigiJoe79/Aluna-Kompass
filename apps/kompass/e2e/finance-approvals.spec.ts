import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { backToAdmin, callTool, linkOwnContact, mcpClient, PDF, PHONE, rejectInQueue, submitClaim, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/** > 1 MB (N9, Befundliste 0.2.0) — erzeugt mit `docs/intern/recherche/2026-09-26-upload-repro/mkpdf.py`. */
const BIG_PDF = path.resolve(import.meta.dirname, 'fixtures/beleg-1500k.pdf');

/**
 * F8a Task 6 — D3 „Freigaben“ (`/finance/approvals`), Desktop zuerst, dazu
 * 390 px und die Kacheln. Anna Berger (Verwaltung, verknüpft mit Tomas
 * Leitner) reicht über die Werkzeuge ein; Jonas Feld (Freigeber, mit
 * `finance.read`) entscheidet. Die Belege sind heute datiert.
 */

const queue = (page: Page) => page.getByTestId('approval-queue');
const detail = (page: Page) => page.getByTestId('approval-detail');
const footer = (page: Page) => page.getByTestId('approval-footer');
const position = (page: Page, n: number) => page.getByTestId('approval-position').nth(n - 1);

test.describe('finance approvals (D3)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await linkOwnContact(page);
  });

  test('die Warteschlange zeigt die älteste zuerst und nie den eigenen Antrag; der direkte Aufruf zeigt den Sperrzustand', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    // Der Seed lässt schon einen Antrag eingereicht (Nadja Vogt) — er ist älter als alles,
    // was dieser Test selbst anlegt, und steht deshalb an erster Stelle.
    const seededQueue = await callTool<{ items: { number: string }[] }>(client, 'finance_approvals_list', {});
    const seededNumber = seededQueue.items[0]!.number;
    const older = await submitClaim(client, { purpose: 'Briefmarken', amountCents: 1250 });
    const newer = await submitClaim(client, { purpose: 'Kopierpapier', amountCents: 899 });
    await client.close();

    // Anna hat beide selbst angelegt: nur der Seed-Antrag in ihrer Schlange, ihre eigenen führen in den Sperrzustand.
    await page.goto('/finance/approvals');
    await expect(queue(page).getByTestId('approval-queue-item')).toHaveCount(1);
    await page.goto(`/finance/approvals?claim=${older.id}`);
    const blocked = page.getByTestId('approval-blocked');
    await expect(blocked).toContainText('nicht möglich');
    await expect(blocked).toContainText('Sie haben diesen Antrag selbst angelegt.');
    await expect(blocked).toContainText('Das kann erledigen: Jonas Feld');
    await expect(footer(page)).toHaveCount(0);

    await switchToJonas(page);
    await page.goto('/finance/approvals');
    const items = queue(page).getByTestId('approval-queue-item');
    // Seit F7 Task 7 steht dazwischen die eingereichte Zahlung an „Kinderhilfe Regional e.V.“ aus dem
    // Seed (älter als beide eigenen Anträge dieses Tests, jünger als der Seed-Antrag) — die Warteschlange ist polymorph.
    // Seit F8b Task 7 dahinter die wartende Umwidmung der Verwaltung (freie Mittel → Jugendfreizeit).
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toContainText(seededNumber);
    await expect(items.nth(1)).toContainText('Kinderhilfe Regional e.V.');
    await expect(items.nth(2)).toContainText('freie Mittel → Jugendfreizeit');
    await expect(items.nth(3)).toContainText(older.number!);
    await expect(items.nth(4)).toContainText(newer.number!);
    await expect(items.nth(3)).toContainText('Auslage');
    await expect(items.nth(3)).toContainText('Tomas Leitner');
    await expect(items.nth(3)).toContainText('12,50 €');
    await expect(items.nth(3)).toContainText(/seit \d{2}\.\d{2}\./);
    // Ohne Auswahl steht die älteste rechts — der Seed-Antrag.
    await expect(items.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(detail(page).getByTestId('approval-number')).toHaveText(seededNumber);

    // Pfeil runter wie in der Akte — drei Schritte, weil Partnerzahlung und Umwidmung dazwischenstehen; die
    // Clientnavigation lässt den Fokus nicht auf der Zeile, deshalb vor jedem Druck neu fokussiert.
    await items.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/finance\/approvals\?payment=/);
    await queue(page).getByTestId('approval-queue-item').nth(1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(/\/finance\/approvals\?transfer=/);
    await queue(page).getByTestId('approval-queue-item').nth(2).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page).toHaveURL(`/finance/approvals?claim=${older.id}`);
    await expect(detail(page).getByTestId('approval-number')).toHaveText(older.number!);
    await expect(queue(page).getByTestId('approval-queue-item').nth(3)).toHaveAttribute('aria-current', 'true');
  });

  test('Freigeben verlangt je Position eine Kategorie, übernimmt den Vorschlag, erzeugt die offene Zahlung und zeigt die Überweisungsdaten', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Büromaterial für die Geschäftsstelle', amountCents: 1999, trip: true });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    const head = detail(page).getByTestId('approval-head');
    await expect(head).toContainText(claim.number!);
    await expect(head).toContainText('40,99 €');
    await expect(head).toContainText('Tomas Leitner');
    await expect(head).toContainText('DE93 **** **** **** **00 01');
    await expect(position(page, 1)).toContainText('Büromaterial für die Geschäftsstelle');
    await expect(position(page, 2)).toContainText('Musterstadt – Beispielstadt, 84 km');
    await expect(detail(page).getByTestId('receipt-preview')).toBeVisible();
    await expect(footer(page)).toContainText('Nach der Freigabe entsteht eine offene Zahlung an Tomas Leitner über 40,99 €.');
    await expect(footer(page)).toContainText('Freigeben kann nur ein Mensch.');

    // Ohne Kategorie keine Freigabe — die Ablehnung nennt die Position.
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    await expect(footer(page).getByRole('alert')).toContainText('Position 1 hat noch keine Kategorie.');

    // Der Vorschlag ist schwach: nicht vorbelegt, aber mit Grund und übernehmbar.
    const suggestion = position(page, 1).getByTestId('category-suggestion');
    await expect(suggestion).toContainText('Vorschlag, weil:');
    await expect(position(page, 1).getByLabel('Kategorie')).toHaveValue('');
    await suggestion.getByRole('button', { name: 'übernehmen' }).click();
    await expect(position(page, 1).getByLabel('Kategorie')).not.toHaveValue('');
    await expect(position(page, 1).getByTestId('category-explanation')).toContainText('Ideeller Bereich');
    await position(page, 2).getByLabel('Kategorie').selectOption({ label: 'Fahrt- und Reisekosten' });

    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    const result = page.getByTestId('approval-result');
    await expect(result).toContainText('freigegeben');
    await expect(result).toContainText('Es ist eine offene Zahlung entstanden');
    const transfer = result.getByTestId('transfer-block');
    await expect(transfer).toContainText('Tomas Leitner');
    await expect(transfer).toContainText('DE93 9999 9999 0000 0000 01');
    await expect(transfer).toContainText('40,99 €');
    await expect(transfer).toContainText(claim.number!);
    // N5: der EPC-QR steht neben den Feldern, mit dem Empfängernamen im aria-label.
    const qr = transfer.getByTestId('transfer-qr');
    await expect(qr).toBeVisible();
    await expect(qr.getByRole('img', { name: 'QR-Code für die Überweisung an Tomas Leitner' })).toBeVisible();
    // Freigegeben verlässt die Schlange — der Seed-Antrag (Nadja Vogt) wartet dort weiter.
    await expect(queue(page)).not.toContainText(claim.number!);

    await page.goto('/finance/open-items');
    await expect(page.getByText(claim.number!)).toBeVisible();
  });

  test('Q Rest (Recheck sha-0170e73): brächte „bezahlt aus“ einen Zweck ins Minus, fragt die Freigabe nach einer Begründung — sie steht am Antrag', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Leerer Zweck Q E2E' } });
    const claim = await submitClaim(client, { purpose: 'Futter für die Pflegestelle', amountCents: 1250 });

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    await position(page, 1).getByLabel('Kategorie').selectOption({ label: 'Fahrt- und Reisekosten' });
    await position(page, 1).getByLabel('bezahlt aus').selectOption({ label: 'Leerer Zweck Q E2E' });
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    const prompt = page.getByTestId('purpose-reason');
    await expect(prompt).toContainText('Der Zweck „Leerer Zweck Q E2E“ stünde danach bei');
    await expect(page.getByTestId('approval-result')).toHaveCount(0);
    await prompt.getByLabel('Begründung trotz Zweck im Minus').fill('Zuschuss der Gemeinde ist zugesagt');
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    await expect(page.getByTestId('approval-result')).toContainText('freigegeben');
    const approved = await callTool<{ purposeNegativeReason: string | null }>(client, 'finance_expense_get', { id: claim.id });
    expect(approved.purposeNegativeReason).toBe('Zuschuss der Gemeinde ist zugesagt');
    await client.close();
  });

  test('eine Fahrtposition schlägt „Fahrt- und Reisekosten“ vor; eine neue IBAN steht als Hinweis, keine Sperre (Befunde 4, 7)', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    // Eine erfundene, sicher unbekannte IBAN — nicht die feste EXPENSE_IBAN aus dem Seed-Muster.
    const freshIban = 'DE23999999990000202051';
    const draft = await callTool<{ id: string; positions: { id: string }[] }>(client, 'finance_expense_draft_save', {
      waiver: false,
      iban: freshIban,
      positions: [
        { kind: 'receipt', positionDate: associationDay(), amountCents: 500, purpose: 'Portokosten' },
        { kind: 'trip', positionDate: associationDay(), tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Pflegestelle besuchen', tripKm: 42 },
      ],
    });
    await callTool(client, 'finance_expense_receipt_upload', { claimId: draft.id, positionId: draft.positions[0]!.id, fileName: 'rechnung.pdf', contentBase64: PDF.buffer.toString('base64') });
    const claim = await callTool<{ id: string; number: string }>(client, 'finance_expense_submit', { id: draft.id });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    await expect(detail(page)).toContainText('IBAN ist neu für diese Person.');
    const tripSuggestion = position(page, 2).getByTestId('category-suggestion');
    await expect(tripSuggestion).toContainText('es eine Fahrt ist');
    await tripSuggestion.getByRole('button', { name: 'übernehmen' }).click();
    await expect(position(page, 2).getByLabel('Kategorie')).not.toHaveValue('');
  });

  test('eine reine Fahrt hat keine Beleg-Vorschau: die Positionskarte ist so breit wie die Kopfkarte (Befund 14)', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const draft = await callTool<{ id: string }>(client, 'finance_expense_draft_save', {
      waiver: false,
      iban: 'DE23999999990000202051',
      positions: [{ kind: 'trip', positionDate: associationDay(), tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Pflegestelle besuchen', tripKm: 24 }],
    });
    const claim = await callTool<{ id: string }>(client, 'finance_expense_submit', { id: draft.id });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    const head = await detail(page).getByTestId('approval-head').boundingBox();
    const card = await position(page, 1).boundingBox();
    expect(head).not.toBeNull();
    expect(card).not.toBeNull();
    // Ohne Vorschau gibt es keine zweite Spalte: die Karte geht über die volle Breite, nicht über die halbe.
    expect(Math.abs(card!.width - head!.width)).toBeLessThan(4);
  });

  test('Verzicht: die Prüfungen als Checkliste; ohne Verzichtserklärung und ohne ihre unterschriebene Fassung keine Freigabe; danach steht die Aufwandsspende als Buchung und ist bescheinigbar', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.expenseWaiverBasisText', 'Satzung § 9 Abs. 2');
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Kopierpapier', amountCents: 2520, waiver: true });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    await expect(queue(page).getByTestId('approval-queue-item').filter({ hasText: claim.number! })).toContainText('Verzicht');
    const checks = detail(page).getByTestId('waiver-checks');
    await expect(checks.getByTestId('requirement-group-missing')).toContainText('Anspruch vorab vereinbart');
    await expect(checks.getByTestId('requirement-group-missing')).toContainText('Verzichtserklärung liegt vor');
    await expect(checks).toContainText('Erfüllt · 2');
    await expect(footer(page)).toContainText('Nach der Freigabe steht eine Aufwandsspende von Tomas Leitner über 25,20 € als Buchung.');
    await expect(detail(page).getByTestId('approval-head')).not.toContainText('DE93');

    await position(page, 1).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    // N6 (KE-008): die Meldung nennt alle fehlenden Punkte auf einmal — Häkchen, Erklärung und unterschriebene Fassung.
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    const alert = footer(page).getByRole('alert');
    await expect(alert).toContainText('Es ist nicht bestätigt, dass der Anspruch vorab vereinbart war.');
    await expect(alert).toContainText('Die Verzichtserklärung liegt noch nicht vor.');
    await expect(alert).toContainText('Die unterschriebene Verzichtserklärung liegt noch nicht vor.');
    await checks.getByRole('checkbox', { name: 'Anspruch vorab vereinbart' }).check();
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    await expect(footer(page).getByRole('alert')).toContainText('Die Verzichtserklärung liegt noch nicht vor.');
    await expect(footer(page).getByRole('alert')).not.toContainText('Es ist nicht bestätigt');

    await checks.getByRole('button', { name: 'Verzichtserklärung erzeugen' }).click();
    await expect(checks.getByRole('link', { name: 'Verzichtserklärung öffnen' })).toBeVisible();
    // Das Häkchen überlebt das Erzeugen.
    await expect(checks.getByRole('checkbox', { name: 'Anspruch vorab vereinbart' })).toBeChecked();

    // Befund H: erzeugt ist nicht unterschrieben — ohne die unterschriebene Fassung keine Freigabe.
    await expect(checks.getByTestId('requirement-group-missing')).toContainText('Unterschriebene Fassung liegt vor');
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    await expect(footer(page).getByRole('alert')).toContainText('Die unterschriebene Verzichtserklärung liegt noch nicht vor.');
    await checks.locator('input[type="file"]').setInputFiles(PDF);
    await expect(checks.getByRole('link', { name: 'Unterschriebene Fassung öffnen' })).toBeVisible();
    await expect(checks.getByTestId('requirement-group-missing')).toHaveCount(0);

    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    const result = page.getByTestId('approval-result');
    await expect(result).toContainText('freigegeben');
    await expect(result).toContainText('Es ist eine Aufwandsspende entstanden');
    await expect(result.getByRole('link', { name: 'Buchung ansehen' })).toBeVisible();

    await page.goto('/finance/donations?tab=uncertified');
    const group = page.getByTestId('uncertified-group').filter({ hasText: 'Tomas Leitner' });
    await expect(group.getByTestId('uncertified-line').filter({ hasText: '25,20 €' })).toBeVisible();
  });

  test('J Rest: eine Grundlage, die jünger ist als die Aufwendung — das Formular warnt, als Verzicht wird nicht eingereicht (Prüfer-Fixrunde 28.09.)', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.expenseWaiverBasisText', 'Satzung § 9 Abs. 2');
    await setE2ESetting(page, 'finance.expenseWaiverBasisAgreedOn', associationDay(1));
    const client = await mcpClient(page, baseURL);
    const draft = await submitClaim(client, { purpose: 'Kopierpapier', amountCents: 2520, waiver: true, submit: false });
    const refused = await client.callTool({ name: 'finance_expense_submit', arguments: { id: draft.id } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('waiverAgreedAfterPosition');
    await client.close();

    await page.goto(`/finance/expenses/new?id=${draft.id}`);
    await expect(page.getByTestId('expense-waiver-agreed-late')).toContainText('Reichen Sie ihn als Erstattung mit IBAN ein.');
  });

  test('eine unterschriebene Verzichtserklärung über 1 MB kommt an (N9)', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.expenseWaiverBasisText', 'Satzung § 9 Abs. 2');
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Kopierpapier', amountCents: 2520, waiver: true });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    const checks = detail(page).getByTestId('waiver-checks');
    await checks.getByRole('button', { name: 'Verzichtserklärung erzeugen' }).click();
    await expect(checks.getByRole('link', { name: 'Verzichtserklärung öffnen' })).toBeVisible();

    await checks.locator('input[type="file"]').setInputFiles(BIG_PDF);
    await expect(checks.getByRole('link', { name: 'Unterschriebene Fassung öffnen' })).toBeVisible();
  });

  test('Ablehnen verlangt den Grund; die Antragstellerin sieht ihn', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Druckerpatronen', amountCents: 3000 });
    await client.close();

    await switchToJonas(page);
    await page.goto(`/finance/approvals?claim=${claim.id}`);
    await footer(page).getByRole('button', { name: 'Ablehnen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Den Grund liest Tomas Leitner in den eigenen Anträgen.');
    await dialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(dialog.getByText('Bitte nennen Sie den Grund.')).toBeVisible();
    await dialog.getByLabel('Grund').fill('Die Rechnung ist auf eine andere Person ausgestellt.');
    await dialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(page.getByTestId('approval-result')).toContainText('abgelehnt');

    await backToAdmin(page);
    await page.goto(`/finance/expenses/${claim.id}`);
    await expect(page.getByTestId('claim-reason')).toContainText('Die Rechnung ist auf eine andere Person ausgestellt.');
    await expect(page.getByRole('button', { name: 'Neu einreichen' })).toBeVisible();
  });

  test('Freigeben auf 390 px mit klebender Fußleiste', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Briefmarken', amountCents: 1250, trip: true });
    await client.close();

    await switchToJonas(page);
    await page.setViewportSize(PHONE);
    await page.goto('/finance/approvals');
    // Auf dem Telefon erst die Liste als Karten, das Detail erst nach der Wahl.
    await expect(detail(page)).toBeHidden();
    // Der Seed (Nadja Vogt) hat bereits einen älteren Antrag eingereicht — gezielt den eigenen wählen.
    await queue(page).getByTestId('approval-queue-item').filter({ hasText: claim.number! }).click();
    await expect(page).toHaveURL(`/finance/approvals?claim=${claim.id}`);
    await expect(queue(page)).toBeHidden();
    await expect(detail(page).getByRole('link', { name: 'Beleg ansehen' })).toBeVisible();

    // Die Fußleiste klebt: ganz oben auf der Seite ist sie schon zu sehen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(footer(page)).toBeInViewport();
    // Die Leiste ist die gemeinsame: Knöpfe untereinander, Hauptaktion oben, beide so hoch wie ein Feld (--field-h).
    const approveBox = (await footer(page).getByRole('button', { name: 'Freigeben' }).boundingBox())!;
    const rejectBox = (await footer(page).getByRole('button', { name: 'Ablehnen' }).boundingBox())!;
    expect(approveBox.height).toBeGreaterThanOrEqual(38);
    expect(rejectBox.height).toBeGreaterThanOrEqual(38);
    expect(approveBox.y).toBeLessThan(rejectBox.y);

    await position(page, 1).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await position(page, 2).getByLabel('Kategorie').selectOption({ label: 'Fahrt- und Reisekosten' });
    await footer(page).getByRole('button', { name: 'Freigeben' }).click();
    const result = page.getByTestId('approval-result');
    await expect(result).toContainText('Es ist eine offene Zahlung entstanden');

    // Review Focus 4: unter 390 px liegt der QR unter den Feldern, nie daneben, und die Seite scrollt nicht seitlich.
    const transfer = result.getByTestId('transfer-block');
    const qr = transfer.getByTestId('transfer-qr');
    await expect(qr).toBeVisible();
    const fieldsBox = (await transfer.locator('> div').first().boundingBox())!;
    const qrBox = (await qr.boundingBox())!;
    expect(qrBox.y).toBeGreaterThanOrEqual(fieldsBox.y + fieldsBox.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('die Kacheln zeigen „Wartet auf Ihre Freigabe“ und „Ihre Auslagen“ ohne fremde Namen', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const claim = await submitClaim(client, { purpose: 'Briefmarken', amountCents: 1250 });
    await client.close();

    await page.setViewportSize(PHONE);
    await page.goto('/');
    const mine = page.getByTestId('dashboard-tile-finance-myExpenses');
    await expect(mine.getByRole('heading', { name: 'Ihre Auslagen' })).toBeVisible();
    await expect(mine).toContainText(`${claim.number} · 12,50 € — wartet auf Freigabe`);
    // Der eigene Antrag wartet nicht auf Annas Freigabe — nur der Seed-Antrag (Nadja Vogt) zählt hier.
    await expect(page.getByTestId('dashboard-tile-finance-approvalsPending')).not.toContainText(claim.number!);

    await switchToJonas(page);
    await page.setViewportSize(PHONE);
    // Jonas hat die Kachel schon in seiner gespeicherten Anordnung (F8a Task 7: der
    // Finanz-Seed trägt sie nach) — kein „Vorgabe wiederherstellen“ nötig.
    await page.goto('/');
    const pending = page.getByTestId('dashboard-tile-finance-approvalsPending');
    await expect(pending.getByRole('heading', { name: 'Wartet auf Ihre Freigabe' })).toBeVisible();
    // Eine Auslage, eine Zahlung an Partner und eine Umwidmung warten schon aus dem Seed (Nadja Vogt,
    // „Kinderhilfe Regional e.V.“, F8b: freie Mittel → Jugendfreizeit), dazu Annas eben eingereichte.
    await expect(pending).toContainText('4');
    await expect(pending).not.toContainText('Tomas Leitner');
    await expect(pending).not.toContainText('12,50');
    await expect(pending.getByRole('link', { name: 'Zu den Freigaben' })).toHaveAttribute('href', '/finance/approvals');
  });
});
