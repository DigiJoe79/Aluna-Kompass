import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

test.describe('finance', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('das Journal zeigt die Buchungen des Seeds mit Zustand als Wort', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(page.getByRole('row', { name: /festgeschrieben/ }).first()).toBeVisible();
  });

  test('der Zustandsfilter zeigt nur Entwürfe und überlebt das Sortieren', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.getByLabel('Zustand').selectOption('draft');
    await expect(page).toHaveURL(/state=draft/);
    await expect(page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' })).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Entwurf geprüft' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sortieren nach Datum' }).click();
    await expect(page).toHaveURL(/state=draft/);
    await expect(page).toHaveURL(/sort=entryDate/);
  });

  test('die Summenzeile nennt die gefilterte Menge', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await expect(page.getByText(/Summe über die gefilterten \d+ Buchungen/)).toBeVisible();
  });

  test('eine zurückgenommene Buchung ist mit ihrer Gegenbuchung verlinkt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    const row = page.locator('tr', { hasText: 'Fehlerhafte Spendenbuchung' });
    await expect(row.getByRole('link', { name: /zurückgenommen durch/ })).toBeVisible();
  });

  test('Mehrfachauswahl: zwei Entwürfe als geprüft markieren, dann festschreiben; die Nummern erscheinen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    const rowA = page.locator('tr', { hasText: 'Entwurf ungeprüft' }).filter({ hasNotText: 'zwei' });
    const rowB = page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' });
    await rowA.getByRole('checkbox').click();
    await rowB.getByRole('checkbox').click();
    await expect(page.getByText('2 Buchungen ausgewählt')).toBeVisible();
    await page.getByRole('button', { name: 'als geprüft markieren' }).click();
    await expect(page.getByText('Als geprüft markiert.')).toBeVisible();

    const rowA2 = page.locator('tr', { hasText: 'Entwurf ungeprüft' }).filter({ hasNotText: 'zwei' });
    const rowB2 = page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' });
    await rowA2.getByRole('checkbox').click();
    await rowB2.getByRole('checkbox').click();
    await page.getByRole('toolbar').getByRole('button', { name: 'festschreiben' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'festschreiben' }).click();
    await expect(page.getByText(/Festgeschrieben: /)).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' }).getByRole('cell').nth(1)).toContainText(/\d{4}-\d+/);
  });

  test('ohne finance.read steht die ForbiddenCard', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/finance/entries');
    await expect(page.getByText('finance.read')).toBeVisible();
  });

  test('die Randspalte merkt sich die ausdrückliche Wahl', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.getByRole('button', { name: 'Ausklappen' }).click();
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('kompass.financeSidePanel'));
    expect(stored).toBe('"open"');
    await page.reload();
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
  });

  test('einfache Ausgabe: anlegen, ausgeglichen, als Entwurf speichern, im Journal wiederfinden', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe Büromaterial');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('42,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('42,00');
    await expect(page.getByText('Ausgeglichen')).toBeVisible();
    await page.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(page).toHaveURL('/finance/entries');
    await expect(page.locator('tr', { hasText: 'Testausgabe Büromaterial' })).toBeVisible();
  });

  test('Auszahlung einer Spendenplattform: „Noch 85,00 € zu verteilen“, dann „Rest hierher“, „Ausgeglichen“', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=income');
    await page.getByLabel('Text').fill('Testauszahlung Plattform');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Spendenplattform' });
    await accountCard.getByLabel('Betrag').fill('485,00');

    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Geldspenden' });
    await rows.nth(0).getByLabel('Betrag').fill('200,00');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(1).getByLabel('Kategorie').selectOption({ label: 'Geldspenden' });
    await rows.nth(1).getByLabel('Betrag').fill('200,00');

    await expect(page.getByText('Noch 85,00 € zu verteilen')).toBeVisible();

    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(2).getByLabel('Kategorie').selectOption({ label: 'Geldspenden' });
    await rows.nth(2).getByRole('button', { name: 'Zeilenmenü' }).click();
    await page.getByRole('menuitem', { name: /Rest hierher/ }).click();

    await expect(page.getByText('Ausgeglichen')).toBeVisible();
  });

  test('Festschreiben einer unausgeglichenen Buchung wird abgelehnt und nennt einen Ausweg; der Ausweg führt zur Nummer', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe unausgeglichen');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('100,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('60,00');

    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page.getByText('Rest in diese Zeile eintragen')).toBeVisible();

    await page.getByRole('button', { name: 'Rest in diese Zeile eintragen' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    await expect(page.getByTestId('entry-number')).toContainText(/\d{4}-\d+/);
  });

  test('Umbuchung Bank → Kasse hat kein „Wofür?“ und sagt, dass sie weder Einnahme noch Ausgabe ist', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=transfer');
    await expect(page.getByTestId('finance-allocation-card')).toHaveCount(0);
    await expect(page.getByText('Eine Umbuchung ist weder Einnahme noch Ausgabe.')).toBeVisible();
    await page.getByLabel('Text').fill('Testabhebung');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Von Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').nth(0).fill('50,00');
    await accountCard.getByLabel('Auf Konto').selectOption({ label: 'Barkasse' });
    await accountCard.getByLabel('Betrag').nth(1).fill('50,00');
    await expect(page.getByText('Ausgeglichen')).toBeVisible();
  });

  test('Sachspende hat kein Konto; die zweite Zeile folgt der ersten', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=inKind');
    await expect(page.getByTestId('finance-account-card')).toHaveCount(0);
    await page.getByLabel('Text').fill('Testsachspende');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Sachspenden' });
    await rows.nth(0).getByLabel('Betrag').fill('75,00');
    await expect(rows.nth(1).getByLabel('Betrag')).toHaveValue('−75,00');
    await expect(rows.nth(1).getByLabel('Kategorie')).toBeDisabled();
  });

  test('bei einer Kasse gibt es keinen Entwurf, nur Festschreiben', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testbarausgabe');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Barkasse' });
    await expect(page.getByText('Bargeld wird am selben Tag festgehalten.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Als Entwurf speichern' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Speichern und als geprüft markieren' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Festschreiben', exact: true })).toBeVisible();
  });

  test('ein Foto als Beleg wird am Feld abgewiesen, die Eingaben bleiben', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe mit Foto');
    await page.getByTestId('voucher-file-input').setInputFiles({ name: 'beleg.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Das ist ein Foto.')).toBeVisible();
    await expect(page.getByLabel('Text')).toHaveValue('Testausgabe mit Foto');
  });

  test('ein PDF als Beleg hängt danach an der Buchung', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe mit PDF-Beleg');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('30,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('30,00');

    await page.getByTestId('voucher-file-input').setInputFiles({ name: 'beleg.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await expect(page.getByRole('link', { name: 'öffnen' })).toBeVisible();
  });

  test('die Ansicht nennt die berechnete Umsatzsteuer je Aufteilung, wenn der Verein Unternehmer ist', async ({ page }) => {
    await loginAsAdmin(page);
    await setE2ESetting(page, 'finance.isEntrepreneurOrHasVatId', true);
    try {
      await page.goto('/finance/entries/new?template=expense');
      await page.getByLabel('Text').fill('Testausgabe mit Reverse Charge');
      const accountCard = page.getByTestId('finance-account-card');
      await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
      await accountCard.getByLabel('Betrag').fill('100,00');
      const allocationCard = page.getByTestId('finance-allocation-card');
      const rows = allocationCard.getByTestId('split-row');
      await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
      await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
      await rows.nth(0).getByLabel('Betrag').fill('100,00');
      await rows.nth(0).getByLabel('Umsatzsteuer').selectOption({ label: 'Reverse Charge (§ 13b)' });
      await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
      await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
      await expect(page.getByText(/Sie schulden .* Umsatzsteuer \(§ 13b\) — auch als Kleinunternehmer/)).toBeVisible();
    } finally {
      await setE2ESetting(page, 'finance.isEntrepreneurOrHasVatId', false);
    }
  });

  test('eine Buchung, die eine offene Zahlung begleicht, nennt sie unter „Hängt zusammen mit“', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Teilzahlung Lieferant' }).click();
    await expect(page.getByText('Hängt zusammen mit')).toBeVisible();
    await expect(page.getByText(/RE-2026-055/)).toBeVisible();
    await expect(page.getByText(/Rest 120,00 €/)).toBeVisible();
    // F3b Task 3 (A6): der Eintrag verlinkt jetzt auf die offene Zahlung.
    await page.getByRole('link', { name: /RE-2026-055/ }).click();
    await expect(page).toHaveURL(/\/finance\/open-items\?tab=payable&item=/);
  });

  test('nach dem Festschreiben steht man auf der Buchung und sieht ihre Nummer', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe direkt festgeschrieben');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('10,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('10,00');
    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    await expect(page.getByTestId('entry-number')).toContainText(/\d{4}-\d+/);
  });

  test('eine Ausgabe begleicht eine offene Zahlung ganz; danach steht sie als erledigt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe Rechnung ganz beglichen');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('120,00');
    await accountCard.getByRole('button', { name: 'begleicht offene Zahlung' }).click();
    await accountCard.getByRole('button').filter({ hasText: 'RE-2026-041' }).click();
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('120,00');
    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    await expect(page.getByText('Rest 0,00 €')).toBeVisible();
  });

  test('ein Teilbetrag lässt einen Rest stehen, und der Rest steht an der Buchung', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe Rechnung teilweise beglichen');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('50,00');
    await accountCard.getByRole('button', { name: 'begleicht offene Zahlung' }).click();
    await accountCard.getByRole('button').filter({ hasText: 'RE-2026-041' }).click();
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('50,00');
    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    await expect(page.getByText('Rest 70,00 €')).toBeVisible();
  });

  test('ein Teilbetrag über dem Betrag des Kontos wird am Feld abgewiesen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Text').fill('Testausgabe Teilbetrag zu hoch');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('50,00');
    await accountCard.getByRole('button', { name: 'begleicht offene Zahlung' }).click();
    await accountCard.getByRole('button').filter({ hasText: 'RE-2026-041' }).click();
    await accountCard.getByLabel('Teilbetrag').fill('999,00');
    await expect(page.getByText('Der Teilbetrag übersteigt den Betrag des Kontos.')).toBeVisible();
  });

  test('Betragsfeld: 12,5 wird 12,50; 12.50 wird als Format abgelehnt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries/new?template=expense');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    const amount = accountCard.getByLabel('Betrag');
    await amount.fill('12,5');
    await amount.blur();
    await expect(amount).toHaveValue('12,50');

    await amount.fill('12.50');
    await amount.blur();
    await expect(page.getByText('Bitte einen Betrag wie 12,50 eingeben')).toBeVisible();
  });

  test('eine festgeschriebene Buchung hat kein Eingabefeld und genau einen Knopf „Korrigieren“', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Korrigieren' })).toHaveCount(1);
  });

  test('die Schloss-Zeile nennt Datum, Person und Weg', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await expect(page.getByText(/festgeschrieben am \d{2}\.\d{2}\.\d{4} um \d{2}:\d{2} von .+\(.+\)/)).toBeVisible();
  });

  test('eine Buchung aus dem Seed nennt als Weg „System“, nicht „Oberfläche“', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await expect(page.getByText(/\(System\)/)).toBeVisible();
    await expect(page.getByText(/\(Oberfläche\)/)).toHaveCount(0);
  });

  test('der Verlauf nennt, über welchen Kanal eine Buchung angelegt und festgeschrieben wurde', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende Altjahr' }).click();
    const history = page.locator('section', { has: page.getByRole('heading', { name: 'Verlauf' }) });
    // Der Seed bucht mit Kanal `system` (`bookEntry`: anlegen und festschreiben in einem Zug).
    await expect(history.getByText(/angelegt von .* über System/)).toBeVisible();
    await expect(history.getByText(/festgeschrieben von .* über System/)).toBeVisible();
  });

  test('Zuordnung ändern im offenen Jahr wirkt sofort und steht mit Vorher → Nachher im Verlauf', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Auszahlung Spendenplattform' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('button').filter({ hasText: 'Wagner' }).click();
    await page.getByRole('checkbox', { name: 'Spender/Empfänger' }).check();
    await expect(page.getByText('Das ändert die Zuordnung.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Spender/Empfänger' }).fill('Kruse');
    await page.getByTestId('contact-option').filter({ hasText: 'Kruse' }).click();
    await page.getByLabel('Begründung').fill('Testkorrektur Spender');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText('Die Zuordnung wurde sofort geändert.')).toBeVisible();
    await expect(page.getByText(/Zuordnung geändert von/)).toBeVisible();
  });

  test('Buchung zurücknehmen erzeugt die Gegenbuchung und öffnet den vorbelegten Entwurf', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Ausgabe Sommerfest' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'Betrag' }).check();
    await expect(page.getByText('Das nimmt die Buchung zurück.')).toBeVisible();
    await page.getByRole('button', { name: 'Buchung zurücknehmen' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[^/]+\/edit$/);
  });

  test('wer „Betrag“ ankreuzt, bekommt „Buchung zurücknehmen“, auch wenn zusätzlich „Projekt“ angekreuzt ist', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'Projekt' }).check();
    await page.getByRole('checkbox', { name: 'Betrag' }).check();
    await expect(page.getByText('Das nimmt die Buchung zurück.')).toBeVisible();
  });

  test('Korrigieren an einer geteilten Buchung: die dritte Aufteilung bekommt ein anderes Projekt, die übrigen bleiben', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Auszahlung Spendenplattform' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('button').filter({ hasText: '100,00' }).click();
    await page.getByRole('checkbox', { name: 'Projekt' }).check();
    await expect(page.getByText('Das ändert die Zuordnung.')).toBeVisible();
    await page.getByRole('combobox', { name: 'Projekt' }).selectOption({ index: 1 });
    await page.getByLabel('Begründung').fill('Testkorrektur Projekt der dritten Zeile');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText('Die Zuordnung wurde sofort geändert.')).toBeVisible();
    await expect(page.getByTestId('finance-allocation-table').getByText('Zuordnung geändert')).toHaveCount(1);
    await expect(page.getByText(/Zuordnung geändert von/)).toBeVisible();
  });

  test('eine Aufteilung, deren Änderung auf Freigabe wartet, lässt sich nicht erneut wählen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Sponsoring Altjahr' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    const pendingRow = page.getByRole('button').filter({ hasText: 'wartet auf Freigabe' });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow).toBeDisabled();
    const selectableRow = page.getByRole('button').filter({ hasText: '30,00' });
    await expect(selectableRow).toBeEnabled();
  });

  test('bei nur einer Aufteilung gibt es keinen Auswahlschritt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await expect(page.getByText('Welche Aufteilung?')).toHaveCount(0);
    await expect(page.getByText('Die Zuordnung')).toBeVisible();
  });

  test('wer nichts ändert, kann nicht absenden', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bar-Ausgabe Fahrtkosten' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'wird im Ausland verwendet' }).check();
    await page.getByLabel('Begründung').fill('Testkorrektur ohne Änderung');
    await expect(page.getByRole('button', { name: 'Zuordnung ändern' })).toBeDisabled();
    await expect(page.getByText('Ändern Sie mindestens ein Feld.')).toBeVisible();
  });

  test('den Zweck einer Spende ändern verlangt ein Dokument; mit PDF geht es durch', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende mit Zweck' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'Zweck' }).check();
    await page.getByRole('combobox', { name: 'Zweck' }).selectOption({ label: 'Flutlicht' });
    await page.getByLabel('Begründung').fill('Testkorrektur Zweck mit Nachweis');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText('Dokument, das belegt, was die Spenderin bestimmt hat')).toBeVisible();
    await page.getByRole('dialog').getByTestId('voucher-file-input').setInputFiles({ name: 'nachweis.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await expect(page.getByText('Die Zuordnung wurde sofort geändert.')).toBeVisible();
  });

  test('ohne Dokument bleibt der Dialog offen, nennt die Umwidmung, und die Eingaben stehen noch da', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende mit Zweck' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'Zweck' }).check();
    await page.getByRole('combobox', { name: 'Zweck' }).selectOption({ label: 'Flutlicht' });
    await page.getByLabel('Begründung').fill('Testkorrektur Zweck ohne Nachweis');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText('Ohne ein solches Dokument ist es ein „Zweck ändern (Umwidmung)“.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Zweck' })).toBeChecked();
    await expect(page.getByLabel('Begründung')).toHaveValue('Testkorrektur Zweck ohne Nachweis');
  });

  test('nach abgegebener Steuererklärung verlangt die Änderung die Kenntnisnahme zu § 153 AO', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Bankgebühr Altjahr' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'wird im Ausland verwendet' }).check();
    await page.getByRole('switch', { name: 'wird im Ausland verwendet' }).click();
    await page.getByLabel('Begründung').fill('Testkorrektur Auslandsbezug nach Steuererklärung');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText('Ich habe zur Kenntnis genommen, dass eine Berichtigung nach § 153 AO nötig sein kann.')).toBeVisible();
    await page.getByRole('checkbox', { name: /Kenntnis genommen/ }).check();
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText(/wartet auf die Freigabe einer zweiten Person/)).toBeVisible();
  });

  test('im abgeschlossenen Jahr wartet die Änderung auf eine zweite Person, und der Dialog nennt, wer freigeben kann', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Büromaterial Altjahr' }).click();
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    await page.getByRole('checkbox', { name: 'Projekt' }).check();
    await page.getByRole('combobox', { name: 'Projekt' }).selectOption({ index: 1 });
    await page.getByLabel('Begründung').fill('Testkorrektur Projekt im geschlossenen Jahr');
    await page.getByRole('button', { name: 'Zuordnung ändern' }).click();
    await expect(page.getByText(/wartet auf die Freigabe einer zweiten Person — freigeben kann: .*Jonas Feld/)).toBeVisible();
  });

  test('Beleg nachreichen an einer festgeschriebenen Buchung; der Beleg lässt sich ansehen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende Altjahr' }).click();
    await page.getByTestId('voucher-file-input').setInputFiles({ name: 'beleg.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await expect(page.getByRole('link', { name: 'öffnen' })).toBeVisible();
    const href = await page.getByRole('link', { name: 'öffnen' }).getAttribute('href');
    expect(href).toMatch(/\/finance\/entries\/.+\/voucher\/.+/);
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
  });

  test('ohne finance.entriesFinalize fehlt der Knopf „Korrigieren“', async ({ page }) => {
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
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende Altjahr' }).click();
    await expect(page.getByRole('button', { name: 'Korrigieren' })).toHaveCount(0);
  });

  // F3b Task 3 (A5, A6): Bankkonten und Kassen, offene Zahlungen mit Überweisungsblock.

  test('Bankkonten und Kassen zeigen den festgeschriebenen Bestand und, wenn abweichend, den mit geprüften Entwürfen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    const card = page.locator('[role="link"]', { hasText: 'Vereinskonto' });
    await expect(card.getByText(/^[\d.,]+\s?€$/).first()).toBeVisible();
    // „Entwurf geprüft“ liegt im Seed geprüft auf dem Vereinskonto — Bestand und geprüfter Stand weichen ab.
    await expect(card.getByText(/einschließlich geprüfter Entwürfe:/)).toBeVisible();
    // F4 Task 7: die Zeile „Auszug” zeigt jetzt echte Daten — das Vereinskonto hat im Seed keinen Import.
    await expect(card.getByText('Noch kein Auszug geladen.')).toBeVisible();
    // Navigationseinträge im Abschnitt „Buchungen“ (Task 3).
    const sectionNav = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sectionNav.getByRole('link', { name: 'Bankkonten und Kassen' })).toBeVisible();
    await expect(sectionNav.getByRole('link', { name: 'Offene Zahlungen' })).toBeVisible();
  });

  test('die IBAN ist maskiert und lässt sich aufdecken', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    // F4 Task 8: „Importkonto“ (Seed) steht alphabetisch vor „Vereinskonto“ — die Karte gezielt wählen statt `.first()`.
    const card = page.locator('[role="link"]', { hasText: 'Vereinskonto' });
    await expect(card.getByTestId('iban-value')).toHaveText('DE•• •••• •••• •••• ••20 51');
    await card.getByRole('button', { name: 'IBAN aufdecken' }).click();
    await expect(card.getByTestId('iban-value')).toHaveText('DE23999999990000202051');
    await card.getByRole('button', { name: 'IBAN wieder verbergen' }).click();
    await expect(card.getByTestId('iban-value')).toHaveText('DE•• •••• •••• •••• ••20 51');
  });

  test('eine Kasse nennt neutral, wann sie zuletzt gezählt wurde', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    const line = page.getByText('noch nicht gezählt').first();
    await expect(line).toBeVisible();
    // Neutral: kein Warnfarb-Token, kein Badge um den Satz.
    await expect(line).not.toHaveClass(/warning/);
  });

  test('stillgelegte Konten stehen eingeklappt unter einer Aufklappliste', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    // „Altes Sparbuch“ ist im Seed stillgelegt — <summary> hat in Playwright keine Rolle „button“, per Text ansteuern.
    await expect(page.locator('[role="link"]', { hasText: 'Altes Sparbuch' })).not.toBeVisible();
    await page.getByText('Stillgelegt', { exact: false }).click();
    await expect(page.locator('[role="link"]', { hasText: 'Altes Sparbuch' })).toBeVisible();
  });

  test('ohne Konten zeigt die Seite einen leeren Zustand mit Knopf nur bei finance.setup', async ({ page }) => {
    await resetDatabase(page, 'empty');
    await page.goto('/login');
    await expect(page).toHaveURL('/setup');
    await page.getByLabel('Vereinsname').fill('Musterverein e.V.');
    await page.getByLabel('Ihr Name').fill('Anna Berger');
    await page.getByLabel('E-Mail').fill('anna@example.org');
    await page.getByLabel('Passwort').fill('ein-langes-merkbares-passwort');
    await page.getByRole('button', { name: 'Konto anlegen und starten' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/admin/modules');
    // Finanzen hängt von contacts, dms und projects ab (`dependsOn`) — ohne sie
    // lehnt das Einschalten mit `moduleDependencyInactive` ab.
    for (const name of ['Kontakte aktivieren oder deaktivieren', 'Dokumentenmanagement aktivieren oder deaktivieren', 'Projekte aktivieren oder deaktivieren', 'Finanzen aktivieren oder deaktivieren']) {
      await page.getByRole('switch', { name }).click();
      await expect(page.getByRole('switch', { name })).toBeChecked();
    }
    await page.goto('/finance/accounts');
    await expect(page.getByText('Noch keine Konten')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bankkonten und Kassen einrichten' })).toBeVisible();
  });

  test('ein Klick auf das Konto öffnet das Journal gefiltert auf dieses Konto', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/accounts');
    await page.locator('[role="link"]', { hasText: 'Vereinskonto' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\?account=/);
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
  });

  test('offene Zahlung anlegen, im Reiter „Wir zahlen noch“ finden, überfällig steht als Wort da', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/open-items');
    await page.getByRole('button', { name: 'Offene Zahlung anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Datum', { exact: true }).fill('2026-01-05');
    await dialog.getByRole('combobox', { name: 'Kontakt' }).fill('Sandberg');
    await dialog.getByTestId('contact-option').filter({ hasText: 'Mira Sandberg' }).first().click();
    await dialog.getByLabel('Betrag', { exact: true }).fill('75,00');
    await dialog.getByLabel('Fällig am').fill('2026-01-20');
    await dialog.getByLabel('Verwendungszweck').fill('RE-2026-999');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Offene Zahlung angelegt.')).toBeVisible();
    const row = page.getByRole('row', { name: /RE-2026-999/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('überfällig');
    await expect(row).toContainText('Mira Sandberg');
    // Das Datum ist gefärbt, wenn der Posten überfällig ist — deutsches Format, kein rohes ISO-Datum (N3 Nachtrag A).
    await expect(row.getByText('20.01.2026')).toHaveClass(/text-error/);
    await expect(row).not.toContainText(/\d{4}-\d{2}-\d{2}/);

    // Zwei Reiter in der URL: unter „Wir erwarten“ steht der neue Posten nicht.
    await page.getByRole('tab', { name: 'Wir erwarten' }).click();
    await expect(page).toHaveURL(/tab=receivable/);
    await expect(page.getByRole('row', { name: /RE-2026-999/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Wir zahlen noch' }).click();
    await expect(page).toHaveURL(/tab=payable/);
    await expect(page.getByRole('row', { name: /RE-2026-999/ })).toBeVisible();

    // Anlegen/Ändern-Dialog: derselbe Dialog ändert einen vorhandenen Posten.
    await row.click();
    const sheet = page.getByRole('dialog', { name: 'RE-2026-999' });
    await expect(sheet.getByText('20.01.2026')).toBeVisible();
    await expect(sheet).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await page.getByRole('button', { name: 'Ändern' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Betrag', { exact: true }).fill('90,00');
    await editDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Offene Zahlung geändert.')).toBeVisible();
    // Die Seitenleiste bleibt offen und verdeckt die Tabelle für Hilfstechnik — der neue Betrag steht dort.
    await expect(page.getByRole('dialog', { name: 'RE-2026-999' })).toContainText('90,00 €');
  });

  test('der Überweisungsblock kopiert den Verwendungszweck und zeigt keinen QR-Code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAsAdmin(page);
    await page.goto('/finance/open-items');
    await page.getByRole('row', { name: /RE-2026-041/ }).click();
    await expect(page).toHaveURL(/item=/);
    await expect(page.getByText('Eine Bankverbindung ist hier noch nicht hinterlegt.')).toBeVisible();
    await expect(page.getByAltText(/QR/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Kopieren: Verwendungszweck' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('RE-2026-041');
  });

  test('„Jetzt buchen“ öffnet die Maske mit Rest und Begleichung; nach dem Festschreiben ist die Zahlung erledigt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/open-items');
    await page.getByRole('row', { name: /RE-2026-041/ }).click();
    await page.getByRole('link', { name: 'Jetzt buchen' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/new\?template=expense&settles=/);
    await page.getByLabel('Text').fill('Rechnung RE-2026-041 beglichen');
    const accountCard = page.getByTestId('finance-account-card');
    await expect(accountCard.getByLabel('Betrag').first()).toHaveValue('120,00');
    await expect(accountCard.getByText('RE-2026-041')).toBeVisible(); // Begleichung vorbelegt (MoneySettlements)
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('120,00');
    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    const bookedNumber = (await page.getByTestId('entry-number').textContent())!.trim();

    await page.goto('/finance/open-items');
    const row = page.getByRole('row', { name: /RE-2026-041/ });
    await expect(row).toContainText('erledigt');

    // „Wird beglichen durch“ nennt die Buchungsnummer als Link.
    await row.click();
    await expect(page.getByRole('link', { name: bookedNumber })).toBeVisible();
  });

  test('„Erledigt ohne Zahlung“ verlangt eine Notiz und nennt die Folgen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/open-items');
    await page.getByRole('row', { name: /RE-2026-041/ }).click();
    await page.getByRole('button', { name: 'Erledigt ohne Zahlung' }).click();
    await expect(page.getByText(/Es entsteht keine Buchung/)).toBeVisible();
    const alertDialog = page.getByRole('alertdialog');
    const confirm = alertDialog.getByRole('button', { name: 'Erledigt ohne Zahlung' });
    await expect(confirm).toBeDisabled();
    await alertDialog.getByLabel('Begründung').fill('Kleinbetrag erlassen, Absprache mit dem Lieferanten');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText('Ohne Zahlung erledigt.')).toBeVisible();
    const row = page.getByRole('row', { name: /RE-2026-041/ });
    await expect(row).toContainText('erledigt ohne Zahlung');
  });

  test('eine offene Zahlung mit Herkunft bietet „Erledigt ohne Zahlung“ nicht an', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/open-items');
    await page.getByRole('row', { name: /ANT-2026-014/ }).click();
    await expect(page).toHaveURL(/item=/);
    await expect(page.getByRole('button', { name: 'Erledigt ohne Zahlung' })).toHaveCount(0);
    await expect(page.getByText('Was mit dem Vorgang geschieht, entscheidet sich an ihm selbst.')).toBeVisible();
  });

  test('ohne finance.entriesFinalize steht dort, wer es erledigen kann', async ({ page }) => {
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

    await page.goto('/finance/open-items');
    await page.getByRole('row', { name: /RE-2026-041/ }).click();
    await expect(page.getByText('Kein Recht zum Erledigen')).toBeVisible();
    await expect(page.getByText('Anna Berger')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erledigt ohne Zahlung' })).toHaveCount(0);
  });

  test('das leere Journal bietet den Weg zur Einrichtung nur, wenn ein Konto ohne Anfangsbestand existiert', async ({ page }) => {
    // Statt einer leeren Installation (H2 — Konten anlegen — kommt erst mit Task 5): eine Suche ohne
    // Treffer zeigt denselben leeren Zustand; „Barkasse“ hat im Seed keinen Anfangsbestand.
    await loginAsAdmin(page);
    // Der Seed schaltet Finanzen und seine Abhängigkeiten wirklich ein (nicht nur
    // vorgetäuscht) — sonst zeigte die neue Sperre „Modul inaktiv“ statt des leeren Journals.
    await page.goto('/admin/modules');
    await expect(page.getByRole('switch', { name: 'Finanzen aktivieren oder deaktivieren' })).toBeChecked();
    await page.goto('/finance/entries?q=kein-treffer-fuer-diesen-text-xyz');
    await expect(page.getByText('Noch keine Buchung.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bankkonten und Kassen einrichten' })).toBeVisible();

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
    // Mira Klein hat finance.read (Kassenprüfer), aber kein finance.setup.
    await page.goto('/finance/entries?q=kein-treffer-fuer-diesen-text-xyz');
    await expect(page.getByText('Noch keine Buchung.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bankkonten und Kassen einrichten' })).toHaveCount(0);
  });

  // Ist erst eine Buchung festgeschrieben, hält Finanzen Kontakte, Belege und
  // Projekte — das Modul lässt sich dann nie mehr ausschalten (`canDisable`
  // in manifest.ts). Der Seed hat solche Buchungen, darum schaltet dieser
  // Test die Einstellung `modules.enabled` direkt (Muster: `setE2ESetting`,
  // wie schon für andere Werte genutzt) statt über den Schalter in
  // `/admin/modules` — geprüft wird hier nur, dass die Seiten das Fehlen des
  // Schlüssels `finance` befolgen, nicht der Dienst `setModuleEnabled`.
  async function disableFinanceModuleSetting(page: import('@playwright/test').Page): Promise<void> {
    await setE2ESetting(page, 'modules.enabled', ['animals', 'contacts', 'dms', 'projects', 'site']);
  }

  test('bei ausgeschaltetem Finanzmodul zeigen die Finanzseiten die Sperre „Modul inaktiv“ und den Weg zu den Modulen', async ({ page }) => {
    await loginAsAdmin(page);
    await disableFinanceModuleSetting(page);

    for (const path of ['/finance/entries', '/finance/accounts', '/finance/cash', '/finance/open-items', '/admin/finance']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Modul Finanzen ist nicht aktiv' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Module öffnen' })).toBeVisible();
    }
  });

  test('ein Beleg-Download antwortet bei ausgeschaltetem Modul mit 404', async ({ page }) => {
    await loginAsAdmin(page);

    // Beleg an einer Buchung.
    await page.goto('/finance/entries');
    await page.locator('tr', { hasText: 'Spende Altjahr' }).click();
    await page.getByTestId('voucher-file-input').setInputFiles({ name: 'beleg.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await expect(page.getByRole('link', { name: 'öffnen' })).toBeVisible();
    const voucherHref = await page.getByRole('link', { name: 'öffnen' }).getAttribute('href');

    // Zählprotokoll einer Kassenzählung ohne Abweichung.
    await page.goto('/finance/cash');
    await page.getByText('Zählkasse', { exact: true }).click();
    await expect(page).toHaveURL(/account=/);
    await page.getByRole('button', { name: 'Kasse oder Dose gezählt' }).click();
    await page.getByLabel('Gezählter Betrag').fill('200,00');
    await page.getByRole('combobox', { name: 'Erste zählende Person' }).fill('Sandberg');
    await page.getByTestId('contact-option').filter({ hasText: 'Mira Sandberg' }).first().click();
    await page.getByRole('combobox', { name: 'Zweite zählende Person' }).fill('Leitner');
    await page.getByTestId('contact-option').filter({ hasText: 'Tomas Leitner' }).first().click();
    await page.getByRole('button', { name: 'Zählung speichern' }).click();
    await expect(page.getByText(/Zählprotokoll KZP-\S+ erstellt/)).toBeVisible();
    const protocolHref = await page.getByRole('link', { name: /KZP-/ }).first().getAttribute('href');

    await disableFinanceModuleSetting(page);

    const voucherResponse = await page.request.get(voucherHref!);
    expect(voucherResponse.status()).toBe(404);
    const protocolResponse = await page.request.get(protocolHref!);
    expect(protocolResponse.status()).toBe(404);
  });

  test('wer einen Schritt nicht selbst erledigen kann, liest in der Checkliste, wer es kann', async ({ page }) => {
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
    await page.getByLabel('Neues Passwort', { exact: true }).fill('mira-hat-noch-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('mira-hat-noch-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    // Mira Klein (Kassenprüfer) hat finance.read, aber weder finance.setup noch users.manage —
    // der Seed bestätigt „Kategorien“ und „Steuerliches“ nie, beide Schritte bleiben offen.
    await page.goto('/admin/finance?panel=checklist');
    const categories = page.getByTestId('requirement-categories');
    await expect(categories).toHaveAttribute('data-done', 'false');
    await expect(categories).toHaveAttribute('data-blocked', 'false');
    await expect(categories.getByTestId('requirement-categories-candoo')).toContainText('kann');
    await expect(categories.getByTestId('requirement-categories-candoo')).toContainText('Anna Berger');
    await expect(categories.getByRole('link', { name: 'Erledigen' })).toHaveCount(0);
    await expect(categories.getByTestId('confirm-categories')).toHaveCount(0);

    const roles = page.getByTestId('requirement-roles');
    await expect(roles).toHaveAttribute('data-done', 'false');
    await expect(roles.getByTestId('requirement-roles-candoo')).toContainText('kann');
  });

  test('die Startseite zeigt „Finanzen: zu tun“, und eine Zeile führt in den gefilterten Journal-Ausschnitt', async ({ page }) => {
    await loginAsAdmin(page);
    const tile = page.getByTestId('dashboard-tile-finance-todo');
    await expect(tile.getByRole('heading', { name: 'Finanzen: zu tun' })).toBeVisible();
    // Seed: eine geprüfte, noch nicht festgeschriebene Buchung — verlinkt den Journal-Ausschnitt „geprüft“.
    const link = tile.getByRole('link', { name: /geprüfte, noch nicht festgeschriebene Buchung/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/finance\/entries\?state=reviewed/);
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
  });

  test('auf 390 px steht das Datum unter dem Satz und nichts läuft seitlich über', async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const tile = page.getByTestId('dashboard-tile-finance-todo');
    const line = tile.locator('li').first();
    const titleBox = (await line.getByTestId('tile-line-title').boundingBox())!;
    const dateBox = (await line.getByTestId('tile-line-date').boundingBox())!;
    // Unter 391 px steht das Datum unter dem Satz: seine Kante liegt tiefer, nicht daneben.
    expect(dateBox.y).toBeGreaterThan(titleBox.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('die Projektseite zeigt Ziel, Einnahmen, Ausgaben und Ergebnis ohne Namen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Winterhilfe für Streuner' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    const section = page.getByTestId('project-finance-section');
    await expect(section.getByText('Zielbetrag')).toBeVisible();
    await expect(section).toContainText('2.500,00 €');
    await expect(section.getByText('Einnahmen')).toBeVisible();
    await expect(section.getByText('Ausgaben')).toBeVisible();
    await expect(section.getByText('Ergebnis')).toBeVisible();
    await expect(section).not.toContainText('Musterspenderin');
    await expect(section).not.toContainText('Spenderin');
  });

  test('mit finance.setup lassen sich Zielbetrag und die beiden Schalter am Projekt ändern', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Winterhilfe für Streuner' }).click();
    const section = page.getByTestId('project-finance-section');
    await section.getByRole('button', { name: 'Ändern' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Zielbetrag').fill('3.000,00');
    await dialog.getByLabel('Wird im Ausland verwendet').check();
    await dialog.getByLabel('Spendenstand auf der Webseite zeigen').check();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Finanzfelder geändert.')).toBeVisible();
    await expect(section).toContainText('3.000,00 €');

    await section.getByRole('button', { name: 'Ändern' }).click();
    const dialogAgain = page.getByRole('dialog');
    await expect(dialogAgain.getByLabel('Wird im Ausland verwendet')).toBeChecked();
    await expect(dialogAgain.getByLabel('Spendenstand auf der Webseite zeigen')).toBeChecked();
  });

  test('ohne Finanzrechte fehlt der Abschnitt am Projekt', async ({ page }) => {
    await loginAsAdmin(page);
    // Keine Seed-Rolle trägt `projects.view` ohne Finanzrecht (nur die Administration sieht
    // die Projekte) — eine eigens angelegte Rolle hält die beiden Rechte sauber getrennt.
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Nur Projekte');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Nur Projekte/ }).click();
    await page.getByRole('checkbox', { name: 'Projekte ansehen' }).check();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');

    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Paula Projekt');
    await create.getByLabel('E-Mail').fill('paula@example.org');
    await create.getByLabel('Nur Projekte').check();
    await create.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();

    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('paula@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('paula-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('paula-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/projects');
    await page.getByRole('link', { name: 'Winterhilfe für Streuner' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.getByTestId('project-finance-section')).toHaveCount(0);
  });

  test('bei ausgeschaltetem Finanzmodul fehlt der Finanzabschnitt am Projekt', async ({ page }) => {
    await loginAsAdmin(page);
    await disableFinanceModuleSetting(page);
    try {
      await page.goto('/projects');
      await page.getByRole('link', { name: 'Winterhilfe für Streuner' }).click();
      await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
      await expect(page.getByTestId('project-finance-section')).toHaveCount(0);
    } finally {
      await setE2ESetting(page, 'modules.enabled', ['animals', 'contacts', 'dms', 'finance', 'projects', 'site']);
    }
  });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function samplePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
