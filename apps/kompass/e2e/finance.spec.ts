import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

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
    await expect(page).toHaveURL('/finance/entries');
    await expect(page.locator('tr', { hasText: 'Testausgabe unausgeglichen' }).getByRole('cell').nth(1)).toContainText(/\d{4}-\d+/);
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
    await expect(page).toHaveURL(/\/finance\/entries\/[^/]+$/);
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
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function samplePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
