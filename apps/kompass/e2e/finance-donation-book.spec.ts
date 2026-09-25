import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F6b Task 8 — Oberfläche C4 „Spendenbuch“. Der Seed bringt im laufenden Jahr
 * unter anderem eine bestätigte Geldzuwendung (Erika Beispiel, 250,00 €) und
 * eine unbestätigte ohne Anschrift (Tobias Adler) — der Rest der Zeilen
 * kommt aus mehreren Modul-Seeds zusammen und wird hier nicht einzeln
 * nachgerechnet (das prüft `donation-book.test.ts`); die Prüfung hier gilt
 * der Oberfläche: dass Summen, Abstimmung und Sprung zueinander passen. Dazu
 * (Task 9, Prüfstein 6) der abgeschlossene Serienlauf des Vorjahrs mit einer
 * Rücklastschrift auf Nora Lehmanns Sammelbestätigung — gebucht in diesem
 * Jahr, auf eine Zeile des Vorjahrs.
 */
const YEAR = String(new Date().getUTCFullYear());
const PREVIOUS_YEAR = String(new Date().getUTCFullYear() - 1);
const MINUS = '−';

/** „1.234,56 €“ oder „−12,00 €“ → Cent, für Rechenproben in der Oberfläche. */
function parseEuro(text: string): number {
  const trimmed = text.trim();
  const negative = trimmed.startsWith(MINUS);
  const cents = Math.round(Number(trimmed.replace(/[^0-9,]/g, '').replace(',', '.')) * 100);
  return negative ? -cents : cents;
}

const bookRow = (page: Page, name: string) => page.getByTestId('book-row').filter({ hasText: name });
const reason = (page: Page, key: string) => page.getByTestId('reconciliation-reason').filter({ hasText: key });

test.describe('finance donation book', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('das Spendenbuch zeigt die Summen je Art und die Abstimmung nach Gründen mit Sprung', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/finance/donations/book?year=${YEAR}`);

    const rows = page.getByTestId('book-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // Die Summenzeile: je Art in Mono, „Zusammen“ ist ihre Summe.
    const kindSums = await Promise.all(['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver'].map((kind) => page.getByTestId(`book-sum-${kind}`).innerText()));
    const total = await page.getByTestId('book-sum-total').innerText();
    expect(kindSums.reduce((sum, text) => sum + parseEuro(text), 0)).toBe(parseEuro(total));

    // Erika Beispiels Zuwendung ist bestätigt (Nummer als Link), Sportfreunde Beispieltal noch nicht („—“).
    await expect(bookRow(page, 'Erika Beispiel').filter({ hasText: '250,00 €' }).getByTestId('book-confirmed').getByRole('link')).toBeVisible();
    await expect(bookRow(page, 'Sportfreunde Beispieltal').getByTestId('book-confirmed')).toHaveText('—');

    // Abstimmung: Zuwendungen − Bestätigt = Differenz, und die Gründe erklären genau diese Differenz.
    const donations = parseEuro(await page.getByTestId('reconciliation-donations').innerText());
    const confirmed = parseEuro(await page.getByTestId('reconciliation-confirmed').innerText());
    const difference = parseEuro(await page.getByTestId('reconciliation-difference').innerText());
    expect(donations - confirmed).toBe(difference);
    const reasonRows = page.getByTestId('reconciliation-reason');
    expect(await reasonRows.count()).toBeGreaterThan(0);
    const reasonCents = await reasonRows.evaluateAll((items) => items.map((item) => item.lastElementChild!.lastElementChild!.textContent ?? ''));
    expect(reasonCents.reduce((sum, text) => sum + parseEuro(text), 0)).toBe(difference);

    // Tobias Adler hat keine Anschrift — „Anschrift fehlt“ steht sicher in der Abstimmung, mit Sprung zum Serienlauf.
    const addressReason = reason(page, 'Anschrift fehlt');
    await expect(addressReason).toBeVisible();
    await expect(addressReason.getByRole('link')).toHaveAttribute('href', `/finance/donations/run?year=${YEAR}`);
    await addressReason.getByRole('link').click();
    await expect(page).toHaveURL(`/finance/donations/run?year=${YEAR}`);
  });

  test('eine zurückgegebene Spende steht negativ und ihre Bestätigung als zu korrigieren', async ({ page }) => {
    await loginAsAdmin(page);
    // Der Seed bringt die Rückgabe direkt mit (F6b Task 9, Prüfstein 6): eine Rücklastschrift auf Nora
    // Lehmanns Sammelbestätigung aus dem Serienlauf des Vorjahrs, gebucht in diesem Jahr — die negative
    // Zeile steht deshalb im Spendenbuch dieses Jahres, „zu korrigieren“ in dem des Vorjahrs.
    await page.goto(`/finance/donations/book?year=${YEAR}`);
    await expect(bookRow(page, 'Nora Lehmann').filter({ hasText: `${MINUS}60,00 €` })).toHaveCount(1);

    await page.goto(`/finance/donations/book?year=${PREVIOUS_YEAR}`);
    const toCorrect = page.getByTestId('reconciliation-to-correct');
    await expect(toCorrect).toContainText('1');
    await expect(toCorrect).toContainText('60,00 €');
    await toCorrect.getByRole('link', { name: 'Zu korrigieren' }).click();
    await expect(page).toHaveURL('/finance/donations?tab=toCorrect');
  });

  test('der vereinfachte Nachweis lädt als PDF', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/finance/donations/book?year=${YEAR}`);
    await expect(page.getByText('Für Zuwendungen bis 300,00 € genügt der Bareinzahlungsbeleg oder die Buchungsbestätigung der Bank als Nachweis.')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Vereinfachter Nachweis (PDF)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Vereinfachter-Zuwendungsnachweis.pdf');
  });
});
