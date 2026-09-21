import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F3b Task 2 — Barkasse. Jede Zählung und jede Bargeldbewegung läuft auf der
 * eigens gesäten „Zählkasse“ (Anfangsbestand 200,00 €), nie auf „Barkasse“ —
 * sonst kippen die Bestände, die `finance.spec.ts` schon voraussetzt.
 */
test.describe('finance cash', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  async function openCashPage(page: import('@playwright/test').Page) {
    await page.goto('/finance/cash');
    await page.getByText('Zählkasse', { exact: true }).click();
    await expect(page).toHaveURL(/account=/);
  }

  // Die Suche trifft Vor- oder Nachname je für sich (nie den vollen Namen als Teilstring) — deshalb das letzte Wort.
  const lastWord = (name: string) => name.split(' ').at(-1)!;

  async function pickCounters(page: import('@playwright/test').Page, one: string, two: string) {
    await page.getByRole('combobox', { name: 'Erste zählende Person' }).fill(lastWord(one));
    await page.getByTestId('contact-option').filter({ hasText: one }).first().click();
    await page.getByRole('combobox', { name: 'Zweite zählende Person' }).fill(lastWord(two));
    await page.getByTestId('contact-option').filter({ hasText: two }).first().click();
  }

  test('die Barkasse zeigt den Bestand und drei Aktionen', async ({ page }) => {
    await openCashPage(page);
    await expect(page.getByTestId('cash-balance')).toContainText('200,00 €');
    await expect(page.getByRole('button', { name: 'Kasse oder Dose gezählt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bargeld zur Bank gebracht / abgehoben' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bar bezahlt' })).toBeVisible();
  });

  test('Zählung ohne Abweichung: Protokollnummer erscheint, keine Buchung entsteht', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByLabel('Gezählter Betrag').fill('200,00');
    await pickCounters(page, 'Mira Sandberg', 'Tomas Leitner');
    await page.getByRole('button', { name: 'Zählung speichern' }).click();
    await expect(page.getByText(/Zählprotokoll KZP-\S+ erstellt/)).toBeVisible();
    await expect(page.getByTestId('cash-balance')).toContainText('200,00 €');
  });

  test('Zählung mit Fehlbetrag verlangt einen Satz; danach steht die Buchung „Kassenfehlbetrag“ im Journal und das Protokoll hängt als Beleg daran', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByLabel('Gezählter Betrag').fill('195,00');
    await pickCounters(page, 'Mira Sandberg', 'Tomas Leitner');
    const submit = page.getByRole('button', { name: 'Zählung speichern' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Erklärung zum Fehlbetrag').fill('Wechselgeld verauslagt');
    await submit.click();
    await expect(page.getByText(/Zählprotokoll KZP-\S+ erstellt/)).toBeVisible();
    await page.goto('/finance/entries');
    const row = page.locator('tr', { hasText: 'Kassenzählung' }).filter({ hasText: 'Fehlbetrag' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText('Belege')).toBeVisible();
    await expect(page.getByText(/KZP-/).first()).toBeVisible();
  });

  test('die Zählhilfe addiert Scheine und Münzen zum gezählten Betrag', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByText('Zählhilfe', { exact: true }).click();
    await page.getByLabel('Stückzahlen eintragen').check();
    await page.getByTestId('denomination-10000').fill('2');
    await page.getByTestId('denomination-500').fill('1');
    await expect(page.getByText('205,00 €', { exact: true })).toBeVisible();
  });

  test('zwei gleiche Zählende werden am Feld abgewiesen', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByLabel('Gezählter Betrag').fill('200,00');
    await pickCounters(page, 'Mira Sandberg', 'Mira Sandberg');
    await page.getByRole('button', { name: 'Zählung speichern' }).click();
    await expect(page.getByText('Bitte zwei unterschiedliche Personen wählen.')).toBeVisible();
  });

  test('die Zählenden wählt man aus den Kontakten; eine Organisation lässt sich nicht wählen', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByRole('combobox', { name: 'Erste zählende Person' }).fill('Amtsgericht');
    await expect(page.getByTestId('contact-option').filter({ hasText: 'Amtsgericht' })).toHaveCount(0);
  });

  test('ein Kontakt, der mitgezählt hat, zeigt auf seiner Seite Finanzen als Halter', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByLabel('Gezählter Betrag').fill('200,00');
    await pickCounters(page, 'Mira Sandberg', 'Tomas Leitner');
    await page.getByRole('button', { name: 'Zählung speichern' }).click();
    await expect(page.getByText(/Zählprotokoll KZP-\S+ erstellt/)).toBeVisible();
    await page.goto('/contacts');
    await page.getByRole('link', { name: 'Mira Sandberg' }).click();
    await expect(page.getByText(/Kassenzählung/)).toBeVisible();
  });

  test('Bargeld zur Bank gebracht: Kasse sinkt, Bankkonto steigt, eine Umbuchung steht im Journal', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Bargeld zur Bank gebracht / abgehoben' }).click();
    await page.getByLabel('Betrag').fill('50,00');
    await page.getByRole('button', { name: 'Buchen' }).click();
    await expect(page.getByText('Bargeldbewegung gebucht.')).toBeVisible();
    await expect(page.getByTestId('cash-balance')).toContainText('150,00 €');
  });

  test('Bar bezahlt aus der Vereinskasse öffnet die Buchungsmaske mit der Kasse und nur „Festschreiben“', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Bar bezahlt' }).click();
    await page.getByRole('button', { name: 'Aus der Vereinskasse' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/new\?template=expense&account=/);
    await expect(page.getByRole('combobox', { name: 'Konto' }).first()).toHaveValue(/./);
    await expect(page.getByRole('button', { name: 'Festschreiben' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Als Entwurf speichern' })).toHaveCount(0);
  });

  test('Bar bezahlt aus eigener Tasche legt nichts an und erklärt den Weg', async ({ page }) => {
    await openCashPage(page);
    const urlBefore = page.url();
    await page.getByRole('button', { name: 'Bar bezahlt' }).click();
    await page.getByRole('button', { name: 'Aus eigener Tasche' }).click();
    await expect(page.getByText(/Auslagen reichen Sie künftig selbst ein/)).toBeVisible();
    await expect(page).toHaveURL(urlBefore);
  });

  test('ohne finance.entriesFinalize stehen statt der Aktionen die Namen derer, die es können', async ({ page }) => {
    // „Mira Klein“ (Kernseed „Interne Revision“) bekommt zusätzlich „Kassenprüfer“ (finance.read, finance.overview,
    // documents.export) — ohne finance.entriesFinalize. Muster: e2e/users.spec.ts „is forbidden for a role without users.manage“.
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

    await page.goto('/finance/cash');
    await expect(page.getByText('Anna Berger')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kasse oder Dose gezählt' })).toHaveCount(0);
  });

  test('ohne contacts.view steht statt des Zähl-Dialogs, welches Recht fehlt und wer es vergeben kann', async ({ page }) => {
    // „Ines Brandt“ (Finanz-Seed, F3b Schritt 0): Rolle „Kassenassistenz“ mit finance.read und
    // finance.entriesFinalize, bewusst ohne contacts.view.
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

    await page.goto('/finance/cash');
    await expect(page.getByText('Kein Recht, Kontakte zu lesen')).toBeVisible();
    await expect(page.getByText(/„Kontakte lesen“/)).toBeVisible();
    await expect(page.getByText('Anna Berger')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kasse oder Dose gezählt' })).toHaveCount(0);
    // Die zwei anderen Karten (kein Bezug zu contacts.view) bleiben verfügbar.
    await expect(page.getByRole('button', { name: 'Bargeld zur Bank gebracht / abgehoben' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bar bezahlt' })).toBeVisible();
  });

  test('eine geleerte Spendendose wird eine Einnahme ohne Spender', async ({ page }) => {
    await openCashPage(page);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByRole('button', { name: 'Dose' }).click();
    await page.getByLabel('Bezeichnung der Dose').fill('Sammeldose Empfang');
    await page.getByLabel('Gezählter Betrag').fill('35,00');
    await pickCounters(page, 'Mira Sandberg', 'Tomas Leitner');
    await page.getByRole('button', { name: 'Zählung speichern' }).click();
    await expect(page.getByText(/Zählprotokoll KZP-\S+ erstellt/)).toBeVisible();
    await expect(page.getByTestId('cash-balance')).toContainText('235,00 €');
  });
});
