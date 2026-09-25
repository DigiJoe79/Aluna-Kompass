import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * F5b Task 4 — die Karte „Aus der Rechnung“. Im Seed liegen zwei
 * Finanzbelege ohne Buchung mit eingebetteter ZUGFeRD-Rechnung: „Rechnung
 * TM-2026-0042“ der Tierarztpraxis Muster (119,00 €, unbezahlt) und „Rechnung
 * BM-7781“ von Bürobedarf Muster GmbH (35,00 €, bezahlt — die Büromaterial-Zeile
 * auf „Importkonto“ trägt ihre IBAN). Dazu der gewöhnliche Beleg „Rechnung
 * Büromaterial über 35,00 €“ ohne Anhang. Gelesen wird mit dem echten
 * `pdfdetach` — lokal aus poppler, im Image-Ring aus poppler-utils.
 *
 * Nicht hier: „ohne poppler nennt die Karte die Abhilfe“. `setE2ESetting`
 * schreibt nur Einstellungen; die Texterkennung ist in `lib/deps.ts` fest das
 * echte `createTextExtraction()` und lässt sich zur Laufzeit nicht gegen eine
 * Attrappe tauschen. Der Fall steht als Dienst-Test in
 * `packages/modules/finance/tests/zugferd-read.test.ts`
 * („answers with a remedy when the tools are missing“).
 */
test.describe('finance: Rechnungen mit ZUGFeRD', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  const option = (page: Page, text: string) => page.getByRole('listbox', { name: 'Kontoumsätze' }).getByRole('option').filter({ hasText: text });
  const card = (page: Page) => page.getByRole('region', { name: 'Aus der Rechnung' });

  async function openCardInVouchers(page: Page, subject: RegExp) {
    await page.goto('/finance/work/vouchers');
    await page.getByRole('row', { name: subject }).getByRole('button', { name: 'Aus der Rechnung' }).click();
  }

  test('eine unbezahlte ZUGFeRD-Rechnung ohne Buchung zeigt die Karte und legt mit einem Klick die offene Zahlung an', async ({ page }) => {
    await loginAsAdmin(page);
    await openCardInVouchers(page, /Rechnung TM-2026-0042/);
    await expect(card(page)).toContainText('Tierarztpraxis Muster');
    await expect(card(page)).toContainText('TM-2026-0042');
    await expect(card(page)).toContainText('2026-04-01');
    await expect(card(page)).toContainText('119,00 €');
    await expect(card(page)).toContainText('19 %: 19,00 €');
    await expect(card(page)).toContainText('2026-04-30');
    await expect(card(page)).toContainText('DE25999999990000424242');
    await expect(card(page)).toContainText('Nicht bezahlt');

    await card(page).getByRole('button', { name: 'Offene Zahlung anlegen' }).click();
    await expect(page.getByText('Offene Zahlung angelegt.')).toBeVisible();
    await card(page).getByRole('link', { name: 'Zu den offenen Zahlungen' }).click();
    await expect(page).toHaveURL(/\/finance\/open-items\?tab=payable&item=[0-9A-Z]{26}$/);
    // Die offene Zahlung öffnet sich gleich in ihrem Blatt: Zahlungsreferenz ist die Rechnungsnummer.
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'TM-2026-0042' })).toBeVisible();
    await expect(sheet).toContainText('119,00');

    // Dieselbe Karte in der Akte — jetzt mit der vorhandenen offenen Zahlung statt eines zweiten Knopfs.
    await page.goto('/finance/work/vouchers');
    await page.getByRole('link', { name: /Rechnung TM-2026-0042/ }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(card(page)).toContainText('Zu dieser Rechnung gibt es schon eine offene Zahlung.');
    await expect(card(page).getByRole('button', { name: 'Offene Zahlung anlegen' })).toHaveCount(0);
  });

  test('eine bezahlte Rechnung nennt den Kontoumsatz und führt in die Arbeitsliste, wo der Entwurf Lieferant, Nummer und Steuer trägt', async ({ page }) => {
    await loginAsAdmin(page);
    await openCardInVouchers(page, /Rechnung BM-7781/);
    await expect(card(page)).toContainText('Bürobedarf Muster GmbH');
    await expect(card(page)).toContainText('Bezahlt: Kontoumsatz vom 2026-01-10');
    await card(page).getByRole('link', { name: 'Zum Kontoumsatz buchen' }).click();
    await expect(page).toHaveURL(/\/finance\/work\?raw=[0-9A-Z]{26}&voucher=[0-9A-Z]{26}$/);

    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await expect(detail.getByTestId('pending-invoice')).toContainText('BM-7781');
    await detail.getByRole('button', { name: /Übernehmen und geprüft/ }).click();
    await expect(page.getByText('Übernommen; Angaben aus der Rechnung BM-7781 eingetragen.')).toBeVisible();
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);

    await page.goto('/finance/work?tab=reviewed');
    const entry = page.getByTestId('work-entry').filter({ hasText: 'Bürobedarf Muster GmbH Rechnung BM-7781' });
    await expect(entry).toBeVisible();
    await entry.getByRole('link').click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}\/edit$/);
    await expect(page.getByLabel('Text')).toHaveValue('Bürobedarf Muster GmbH Rechnung BM-7781');

    // Die Steuer zeigt die Maske nur, wenn der Verein Unternehmer ist — dafür kurz umschalten.
    await setE2ESetting(page, 'finance.isEntrepreneurOrHasVatId', true);
    try {
      await page.reload();
      await expect(page.getByTestId('finance-allocation-card').getByTestId('split-row').first().getByLabel('Umsatzsteuer')).toHaveValue('standard');
    } finally {
      await setE2ESetting(page, 'finance.isEntrepreneurOrHasVatId', false);
    }
  });

  test('ein PDF ohne Anhang zeigt keine Karte', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work/vouchers');
    await page.getByRole('link', { name: 'Rechnung Büromaterial über 35,00 €' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('heading', { name: 'Rechnung Büromaterial über 35,00 €' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);

    // Aufgeklappt unter „Belege ohne Buchung“: ein Satz, keine Karte.
    await openCardInVouchers(page, /Rechnung Büromaterial über 35,00 €/);
    await expect(page.getByText('Dieses PDF enthält keine elektronische Rechnung.')).toBeVisible();
    await expect(card(page)).toHaveCount(0);

    // Auf den Kontoumsatz gezogen: ohne Rechnung kein Angebot — der Beleg wird abgelegt wie immer.
    await page.goto('/finance/work');
    await page.getByLabel('Liste für Konto').selectOption({ label: 'Importkonto' });
    await expect(page).toHaveURL(/account=/);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await detail.getByTestId('voucher-file-input').setInputFiles(path.resolve(import.meta.dirname, 'fixtures/brief-digital.pdf'));
    await detail.getByRole('group', { name: 'Beleg ablegen' }).getByRole('button', { name: 'Beleg ablegen' }).click();
    await expect(page.getByText(/Beleg ERE-[\d-]+ im Namen der Buchung abgelegt\./)).toBeVisible();
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Angaben aus der Rechnung übernehmen' })).toHaveCount(0);
  });

  test('ein ZUGFeRD-PDF auf dem Kontoumsatz bietet an, die Angaben aus der Rechnung zu übernehmen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work');
    await page.getByLabel('Liste für Konto').selectOption({ label: 'Importkonto' });
    await expect(page).toHaveURL(/account=/);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await detail.getByTestId('voucher-file-input').setInputFiles(path.resolve(import.meta.dirname, 'fixtures/zugferd/rechnung-buerobedarf.pdf'));
    await detail.getByRole('group', { name: 'Beleg ablegen' }).getByRole('button', { name: 'Beleg ablegen' }).click();

    const offer = detail.getByTestId('invoice-offer');
    await expect(offer).toContainText('Bürobedarf Muster GmbH, BM-7781, 35,00 €');
    await offer.getByRole('button', { name: 'Angaben aus der Rechnung übernehmen' }).click();
    await expect(page.getByText('Angaben aus der Rechnung übernommen.')).toBeVisible();
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);

    await page.goto('/finance/entries');
    await expect(page.locator('tr', { hasText: 'Bürobedarf Muster GmbH Rechnung BM-7781' })).toBeVisible();
  });
});
