import path from 'node:path';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F4 Task 7 — „Hochgeladene Auszüge“ (`/finance/imports`). Läuft ausschließlich
 * auf dem eigens gesäten Bankkonto „Importkonto“ (erfundene IBAN,
 * BLZ 99999999) — kein anderer Test benutzt dieses Konto oder seine Läufe.
 * Der Seed legt bereits zwei fertige Läufe (der zweite mit Lücke), einen
 * offenen Kandidaten, einen verworfenen und einen fehlgeschlagenen Lauf an;
 * jeder Test lädt zusätzlich nur, was er selbst braucht — mit eigenen
 * Dateien, die kein anderer Test verwendet (`packages/modules/finance/tests/e2e-fixtures-camt.test.ts`
 * hält sie gegen den Leser für sich schon grün).
 */
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const fixture = (name: string) => path.join(FIXTURES, name);

test.describe('finance import', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  async function openImports(page: import('@playwright/test').Page) {
    await loginAsAdmin(page);
    await page.goto('/finance/imports');
    await page.getByLabel('Konto', { exact: true }).selectOption({ label: 'Importkonto' });
  }

  test('einen Auszug laden: das Ergebnis nennt neu, bereits vorhanden und zurückgehalten, und das Konto ist „importiert bis“', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles(fixture('neuer-auszug.xml'));
    await expect(page.getByText(/1 neu, 1 bereits vorhanden, 1 zurückgehalten/)).toBeVisible();
    await expect(page.getByText(/Auszug importiert bis 2026-07-31/)).toBeVisible();
  });

  test('denselben Auszug noch einmal laden wird abgelehnt und verlinkt den vorhandenen', async ({ page }) => {
    await openImports(page);
    const input = page.getByTestId('statement-file-input');
    await input.setInputFiles(fixture('duplikat.xml'));
    await expect(page.getByText(/1 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    await input.setInputFiles(fixture('duplikat.xml'));
    await expect(page.getByText(/bereits geladen/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Zum vorhandenen Lauf' })).toBeVisible();
  });

  test('ein Auszug mit fremder IBAN wird abgelehnt und nennt die Abhilfe', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles(fixture('fremde-iban.xml'));
    await expect(page.getByText(/passt nicht zum Konto/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anderes Konto wählen' })).toBeVisible();
  });

  test('ein unlesbarer Auszug steht als fehlgeschlagen in der Liste und nennt die Zeile', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles(fixture('kaputte-zeile.xml'));
    // Die Meldung sofort nach dem Laden nennt schon die Zeile …
    await expect(page.getByText(/Der Auszug lässt sich nicht lesen \(Zeile 2\)/)).toBeVisible();
    // … und der fehlgeschlagene Lauf steht mit derselben Zeile in der Liste, nicht im Tooltip.
    await expect(page.getByText('Zeile 2 ist nicht lesbar.')).toBeVisible();
  });

  test('zwei Dateien auf einmal laufen nacheinander, jede mit eigenem Ergebnis', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles([fixture('mehrere-a.xml'), fixture('mehrere-b.xml')]);
    await expect(page.getByText(/mehrere-a\.xml/)).toBeVisible();
    await expect(page.getByText(/mehrere-b\.xml/)).toBeVisible();
    await expect(page.getByText(/1 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toHaveCount(2);
  });

  test('eine Lücke zwischen zwei Auszügen wird gemeldet, der Import gelingt trotzdem', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles(fixture('luecke-neu.xml'));
    await expect(page.getByText(/1 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    // Der Seed selbst kennt schon eine Lücke (Lauf B) — deshalb der ganze Satz in einer Zusicherung,
    // damit nicht versehentlich die andere Lückenmeldung auf der Seite trifft.
    await expect(page.getByText(/Es fehlen Umsätze zwischen 2026-04-30 und 2026-08-01\. Die Reihenfolge ist Kompass gleich/)).toBeVisible();
  });

  test('ein Kandidat steht neben dem vorhandenen Umsatz; „Eigene Zahlung“ übernimmt ihn', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/imports');
    await expect(page.getByRole('heading', { name: 'Kandidaten' })).toBeVisible();
    await expect(page.getByText('Bueromaterial').first()).toBeVisible();
    await page.getByRole('button', { name: 'Eigene Zahlung — übernehmen' }).click();
    await expect(page.getByRole('heading', { name: 'Kandidaten' })).toHaveCount(0);
  });

  test('Verwerfen nennt die Folgen in Zahlen, verlangt eine Notiz, und der Lauf bleibt als verworfen stehen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/imports');
    const row = page.getByTestId('import-run').filter({ hasText: '2026-02-10 – 2026-02-28' });
    await row.getByRole('button', { name: 'Verwerfen' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/Kontoumsatz wird gelöscht/)).toBeVisible();
    // Ohne Notiz lässt sich nicht bestätigen.
    await expect(dialog.getByRole('button', { name: 'Verwerfen' })).toBeDisabled();
    await dialog.locator('textarea').fill('Testauszug versehentlich geladen');
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page.getByText('Auszug verworfen.')).toBeVisible();
    await expect(row).toContainText('verworfen');
  });

  test('eine festgeschriebene Buchung sperrt das Verwerfen und zeigt den Weg', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/imports');
    const row = page.getByTestId('import-run').filter({ hasText: '2026-01-01 – 2026-01-31' });
    await row.getByRole('button', { name: 'Verwerfen' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Festgeschriebene Buchungen sperren das Verwerfen.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Verwerfen' })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Buchungen zurücknehmen' })).toBeVisible();
  });

  test('die Kontokarte nennt „importiert bis“ und den Abstimmstand', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    const card = page.locator('[role="link"]', { hasText: 'Importkonto' });
    await expect(card.getByText(/Auszug importiert bis 2026-04-30/)).toBeVisible();
    await expect(card.getByText(/Kein Auszug für heute|Stimmt mit dem Auszug|Differenz zum Auszug/)).toBeVisible();
  });

  test('ohne finance.entriesWrite sieht man die Läufe, aber weder Ablagefläche noch Verwerfen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Mira Klein/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('mira@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('mira-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('mira-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/finance/imports');
    await expect(page.getByTestId('import-run').first()).toBeVisible();
    await expect(page.getByTestId('statement-file-input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Verwerfen' })).toHaveCount(0);
  });

  test('ein DOCTYPE im Auszug wird abgewiesen', async ({ page }) => {
    await openImports(page);
    await page.getByTestId('statement-file-input').setInputFiles(fixture('doctype.xml'));
    await expect(page.getByText(/Der Auszug lässt sich nicht lesen\./)).toBeVisible();
  });
});
