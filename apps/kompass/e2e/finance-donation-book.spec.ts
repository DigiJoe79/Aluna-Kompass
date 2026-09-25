import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

/**
 * F6b Task 8 — Oberfläche C4 „Spendenbuch“. Der Seed bringt im laufenden Jahr
 * unter anderem eine bestätigte Geldzuwendung (Erika Beispiel, 250,00 €) und
 * eine unbestätigte ohne Anschrift (Tobias Adler) — der Rest der Zeilen
 * kommt aus mehreren Modul-Seeds zusammen und wird hier nicht einzeln
 * nachgerechnet (das prüft `donation-book.test.ts`); die Prüfung hier gilt
 * der Oberfläche: dass Summen, Abstimmung und Sprung zueinander passen.
 */
const YEAR = String(new Date().getUTCFullYear());
const MINUS = '−';

/** „1.234,56 €“ oder „−12,00 €“ → Cent, für Rechenproben in der Oberfläche. */
function parseEuro(text: string): number {
  const trimmed = text.trim();
  const negative = trimmed.startsWith(MINUS);
  const cents = Math.round(Number(trimmed.replace(/[^0-9,]/g, '').replace(',', '.')) * 100);
  return negative ? -cents : cents;
}

async function mcpClient(page: Page, baseURL: string | undefined): Promise<Client> {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright Spendenbuch');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent ?? JSON.parse((result.content as { text: string }[])[0]!.text)) as T;
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

  test('eine zurückgegebene Spende steht negativ und ihre Bestätigung als zu korrigieren', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    // Eine Rückgabe mit `originLineId` bucht noch kein Formular der Oberfläche (F6b Task 9 bringt sie in den Seed) —
    // hier über MCP, wie in `finance-donations.spec.ts`. Das Buchen über MCP ist an sich `humanOnly`; ein Mensch
    // erlaubt es für diesen Testlauf direkt über die Einstellung (wie der Schalter unter Verwaltung → Finanzen).
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true);

    const client = await mcpClient(page, baseURL);
    const book = await callTool<{ rows: { lineId: string; entryId: string; contactId: string | null; contactName: string | null; kind: string; amountCents: number }[] }>(
      client,
      'finance_donation_book',
      { year: Number(YEAR) },
    );
    const erikaLine = book.rows.find((r) => r.contactName === 'Erika Beispiel' && r.kind === 'donation' && r.amountCents === 25000);
    expect(erikaLine, JSON.stringify(book.rows)).toBeTruthy();
    const entry = await callTool<{ moneyLines: { accountId: string }[]; allocationLines: { categoryId: string; contactId: string | null }[] }>(client, 'finance_entry_get', {
      id: erikaLine!.entryId,
    });
    const accountId = entry.moneyLines[0]!.accountId;
    const categoryId = entry.allocationLines.find((l) => l.contactId === erikaLine!.contactId)!.categoryId;
    await callTool(client, 'finance_entry_book', {
      entryDate: `${YEAR}-09-01`,
      text: 'Rueckzahlung Erika Beispiel Juni',
      moneyLines: [{ accountId, amountCents: -25000 }],
      allocationLines: [{ categoryId, amountCents: -25000, contactId: erikaLine!.contactId, originLineId: erikaLine!.lineId }],
    });
    await client.close();

    await page.goto(`/finance/donations/book?year=${YEAR}`);
    await expect(bookRow(page, 'Erika Beispiel').filter({ hasText: `${MINUS}250,00 €` })).toHaveCount(1);

    const toCorrect = page.getByTestId('reconciliation-to-correct');
    await expect(toCorrect).toContainText('1');
    await expect(toCorrect).toContainText('250,00 €');
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
