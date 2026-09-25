import { expect, test } from './fixtures';
import { resetDatabase } from './helpers';

/**
 * F3b Task 5 — Finanzen einrichten (H1–H8). Die ganze Spec läuft auf einer
 * frisch aus dem Setup-Assistenten entstandenen Installation ohne
 * Finanzdaten (Muster `finance.spec.ts`: „ohne Konten zeigt die Seite einen
 * leeren Zustand…“) — so zeigt die Checkliste „alles offen“, und jede
 * Ablehnung entsteht ohne fremde Vorbedingungen.
 */
async function setupEmptyFinance(page: import('@playwright/test').Page): Promise<void> {
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
  // lehnt das Einschalten ab („Benötigte Module sind nicht aktiv“).
  for (const name of ['Kontakte aktivieren oder deaktivieren', 'Dokumentenmanagement aktivieren oder deaktivieren', 'Projekte aktivieren oder deaktivieren', 'Finanzen aktivieren oder deaktivieren']) {
    await page.getByRole('switch', { name }).click();
    await expect(page.getByRole('switch', { name })).toBeChecked();
  }
}

test.describe('finance setup', () => {
  test.beforeEach(async ({ page }) => {
    await setupEmptyFinance(page);
  });

  test('„Finanzen“ steht im Einstellungsbereich im vorhandenen Abschnitt, nicht in einem eigenen', async ({ page }) => {
    await page.goto('/admin/users');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections.getByText('Einrichtung')).toBeVisible();
    await expect(sections.getByRole('link', { name: 'Finanzen' })).toBeVisible();
    await sections.getByRole('link', { name: 'Finanzen' }).click();
    await expect(page).toHaveURL('/admin/finance');
  });

  test('die Checkliste zeigt erledigte und offene Schritte, und was auf etwas wartet', async ({ page }) => {
    await page.goto('/admin/finance');
    const checklist = page.getByTestId('checklist-panel');
    await expect(checklist.getByTestId('requirement-fiscalYear')).toHaveAttribute('data-done', 'false');
    const accountItem = checklist.getByTestId('requirement-account');
    await expect(accountItem).toHaveAttribute('data-blocked', 'true');
    await expect(accountItem).toContainText('wartet auf ein Geschäftsjahr');
  });

  test('Konto anlegen: eine IBAN mit falscher Prüfziffer wird am Feld abgewiesen; Anfangsbestand verlangt einen Stichtag', async ({ page }) => {
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Vereinskonto');
    await dialog.getByLabel('IBAN').fill('DE24999999990000202051');
    await expect(dialog.getByText('Die Prüfziffer stimmt nicht.')).toBeVisible();
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await expect(dialog.getByText('Die Prüfziffer stimmt nicht.')).not.toBeVisible();
    await dialog.getByLabel('Anfangsbestand').fill('100,00');
    await expect(dialog.getByText('Anfangsbestand und Stichtag gehören zusammen')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  test('das Hauptkonto lässt sich nicht stilllegen — Ablehnung mit Abhilfe', async ({ page }) => {
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Vereinskonto');
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await dialog.getByLabel('Hauptkonto').check();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Konto angelegt.')).toBeVisible();

    await page.getByTestId('account-row-Vereinskonto').getByRole('button', { name: 'Ändern' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Stilllegen statt löschen')).not.toBeVisible();
  });

  test('ein Konto ohne Buchungen lässt sich über den Link „Stilllegen“ stilllegen und steht danach unter den stillgelegten', async ({ page }) => {
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Spendenkonto ohne Buchungen');
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Konto angelegt.')).toBeVisible();

    await page.getByTestId('account-row-Spendenkonto ohne Buchungen').getByRole('button', { name: 'Ändern' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('button', { name: 'Stilllegen statt löschen' }).click();
    await expect(editDialog).toBeHidden();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).toContainText('Stillgelegt');

    await page.goto('/finance/accounts');
    await expect(page.locator('[role="link"]', { hasText: 'Spendenkonto ohne Buchungen' })).not.toBeVisible();
    await page.getByText('Stillgelegt', { exact: false }).click();
    await expect(page.locator('[role="link"]', { hasText: 'Spendenkonto ohne Buchungen' })).toBeVisible();
  });

  test('ohne dms.view fehlt im Konto-Dialog das Dokument zum Anfangsbestand', async ({ page }) => {
    // Auf der frischen Installation gibt es außer Anna Berger (Administration, alle Rechte)
    // niemanden — eine Rolle mit `finance.setup`, aber ohne jedes `dms.*`, entsteht deshalb hier.
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Finanzen ohne Akte');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Finanzen ohne Akte/ }).click();
    await page.getByRole('checkbox', { name: 'Finanzen lesen' }).check();
    await page.getByRole('checkbox', { name: 'Finanzen einrichten' }).check();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');

    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Finn Ohneakte');
    await create.getByLabel('E-Mail').fill('finn@example.org');
    await create.getByLabel('Finanzen ohne Akte').check();
    await create.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();

    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('finn@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('finn-ohne-akte-passwort');
    await page.getByLabel('Passwort wiederholen').fill('finn-ohne-akte-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Beleg zum Anfangsbestand')).toHaveCount(0);
    await expect(dialog.getByText('Ein Beleg zum Anfangsbestand lässt sich nur mit Zugriff auf die Akte hinterlegen.')).toBeVisible();
  });

  test('nur mit finance.setup sieht man im Konten-Panel die Konten samt IBAN', async ({ page }) => {
    // Befundliste 0.2.0, N3 (Joe, 2026-09-23): Wer pflegt, muss sehen, was er pflegt.
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Vereinskonto');
    await create.getByLabel('IBAN').fill('DE23999999990000202051');
    await create.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Konto angelegt.')).toBeVisible();

    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Nur Einrichtung');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Nur Einrichtung/ }).click();
    await page.getByRole('checkbox', { name: 'Finanzen einrichten' }).check();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');

    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const user = page.getByRole('dialog');
    await user.getByLabel('Name').fill('Selma Setup');
    await user.getByLabel('E-Mail').fill('selma@example.org');
    await user.getByLabel('Nur Einrichtung').check();
    await user.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();

    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('selma@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('selma-setup-passwort-lang');
    await page.getByLabel('Passwort wiederholen').fill('selma-setup-passwort-lang');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/admin/finance?panel=accounts');
    const row = page.getByTestId('account-row-Vereinskonto');
    await expect(row).toBeVisible();
    await expect(row.getByText('DE23999999990000202051')).toBeVisible();
  });

  test('„Bankkonten und Kassen einrichten“ führt aus der Kontenübersicht in das Konten-Panel', async ({ page }) => {
    await page.goto('/finance/accounts');
    await page.getByRole('link', { name: 'Bankkonten und Kassen einrichten' }).click();
    await expect(page).toHaveURL('/admin/finance?panel=accounts');
    await expect(page.getByRole('button', { name: 'Konto anlegen' })).toBeVisible();
  });

  test('Zwecke: anlegen, als erfüllt markieren, wieder öffnen', async ({ page }) => {
    await page.goto('/admin/finance?panel=purposes');
    await page.getByRole('button', { name: 'Zweck anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Neues Katzenhaus');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Zweck angelegt.')).toBeVisible();

    const row = page.locator('tr', { hasText: 'Neues Katzenhaus' });
    await expect(row.getByText('Offen', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Erfüllt' }).click();
    await expect(row.getByText('Erfüllt', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Erfüllt' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Wieder öffnen' }).click();
    await expect(row.getByText('Offen', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Wieder öffnen' })).toHaveCount(0);
  });

  test('die Besteuerungsform steht als Zeitreihe mit Erklärsatz unter „Sätze und Grenzen“', async ({ page }) => {
    await page.goto('/admin/finance?panel=datedValues');
    const panel = page.getByTestId('dated-values-panel');
    await expect(panel.getByText('Besteuerungsform', { exact: true })).toBeVisible();
    await expect(panel.getByText('Die Besteuerungsform gilt taggenau — eine Änderung wirkt ab dem gewählten Stichtag.')).toBeVisible();
    await expect(panel.getByText(/Aktuell: (Kleinunternehmer|Regelbesteuerung)/)).toBeVisible();

    await page.getByTestId('dated-value-edit-taxation').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gültig ab').fill('2030-01-01');
    await dialog.getByLabel('Sätze und Grenzen').selectOption('regular');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByText('Vom Verein überschrieben')).toBeVisible();
    // N3 Nachtrag A: der Stichtag steht im deutschen Format, nicht mehr roh als ISO.
    await expect(panel.getByText('01.01.2030')).toBeVisible();
    await expect(panel).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  });

  test('Kategorie: „Spenden gibt es nur im ideellen Bereich“ erscheint am Feld', async ({ page }) => {
    await page.goto('/admin/finance?panel=categories');
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Schlüssel').fill('spenden-test');
    await dialog.getByLabel('Name').fill('Testspenden');
    await dialog.getByLabel('Steuerlicher Bereich').selectOption('business');
    await dialog.getByText('Erweitert').click();
    await dialog.getByLabel('Einnahmeart').selectOption('donation');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByText('Spenden gibt es nur im ideellen Bereich.')).toBeVisible();
  });

  test('eine bestehende Kategorie lässt sich ohne Änderung speichern und stilllegen', async ({ page }) => {
    await page.goto('/admin/finance?panel=categories');
    const row = page.getByTestId('category-row-office');
    await row.getByRole('button', { name: 'Ändern' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Kategorie geändert.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await row.getByRole('button', { name: 'Ändern' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Aktiv').uncheck();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('Stillgelegt')).toBeVisible();
  });

  test('„Kategorien durchgesehen“ hakt den Schritt ab', async ({ page }) => {
    await page.goto('/admin/finance?panel=categories');
    await expect(page.getByText('Noch nicht durchgesehen.')).toBeVisible();
    await page.getByTestId('review-categories').click();
    await expect(page.getByText('Zuletzt durchgesehen am')).toBeVisible();
    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-categories')).toHaveAttribute('data-done', 'true');
  });

  test('„Vorgaben übernehmen“ setzt die Steuer-Schalter und hakt den Schritt ab', async ({ page }) => {
    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-tax')).toHaveAttribute('data-done', 'false');
    await page.getByTestId('apply-tax-defaults').click();
    await expect(page.getByText('Steuer-Vorgaben übernommen.')).toBeVisible();
    await expect(page.getByTestId('requirement-tax')).toHaveAttribute('data-done', 'true');
  });

  test('die Bezeichnung eines Geschäftsjahres mit vergebenen Nummern ist gesperrt, und der Grund steht da', async ({ page }) => {
    await page.goto('/admin/finance?panel=fiscalYears');
    await page.getByRole('button', { name: 'Erstes Geschäftsjahr anlegen' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Beginnt am').fill('2026-01-01');
    await dialog.getByLabel('Endet am').fill('2026-12-31');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Geschäftsjahr angelegt.')).toBeVisible();

    // Ein Konto mit Anfangsbestand bucht die erste Buchungsnummer des Jahres.
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Vereinskonto');
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await dialog.getByLabel('Anfangsbestand').fill('100,00');
    await dialog.getByLabel('Stichtag').fill('2026-01-01');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Konto angelegt.')).toBeVisible();

    // Erst eine Buchungsnummer sperrt die Bezeichnung — ein Entwurf allein nicht.
    await page.goto('/finance/entries/new?template=income');
    await page.getByLabel('Text').fill('Testspende für die Sperre');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('10,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Geldspenden' });
    await rows.nth(0).getByLabel('Betrag').fill('10,00');
    await page.getByRole('button', { name: 'Festschreiben' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[^/]+$/);

    await page.goto('/admin/finance?panel=fiscalYears');
    await page.getByRole('button', { name: 'Ändern' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Bezeichnung').fill('Anders');
    await editDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByTestId('fiscal-year-designation-error')).toContainText('Bezeichnung');
  });

  test('„Darf ein Agent festschreiben?“ ist aus und abgesetzt', async ({ page }) => {
    await page.goto('/admin/finance?panel=tax');
    const row = page.getByTestId('mcp-human-only-row');
    await expect(row).toBeVisible();
    await expect(row.getByRole('checkbox', { name: 'Darf ein Agent festschreiben?' })).not.toBeChecked();
  });

  test('einen Satz ab Stichtag überschreiben und wieder zurücknehmen', async ({ page }) => {
    await page.goto('/admin/finance?panel=datedValues');
    await page.getByTestId('dated-value-edit-vatStandard').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gültig ab').fill('2030-01-01');
    await dialog.getByLabel('Wert').fill('21');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Vom Verein überschrieben')).toBeVisible();

    await page.getByRole('button', { name: 'Zurücknehmen' }).click();
    await expect(page.getByText('Vom Verein überschrieben')).not.toBeVisible();
  });

  test('die Grenze „Kontoauszug genügt bis“ lässt sich setzen und wirkt in der Buchungsmaske', async ({ page }) => {
    // „Wirkt“ heißt hier: Die Einstellung, die der Beleg-Block einer Buchung
    // liest (`documentationOf`, `packages/modules/finance/src/ledger/entries.ts`),
    // übernimmt den neuen Wert sofort — ohne Neustart, ohne zweite Ablage. Die
    // Anzeige „Der Kontoauszug genügt …“ selbst verlangt zusätzlich einen
    // Rohumsatz (einen importierten Kontoauszug, F4/F4b) — das bringt erst ein
    // späterer Plan; bis dahin ist der Effekt in `tests/vouchers.test.ts`
    // bewiesen (Dienst `setFinanceLimit` statt direktem Einstellungs-Schreiben).
    const row = page.getByTestId('tax-limit-statement-suffices');
    try {
      await page.goto('/admin/finance?panel=tax');
      await row.getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?').fill('50,00');
      await row.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Grenze gespeichert.')).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('tax-limit-statement-suffices').getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?')).toHaveValue('50,00');
    } finally {
      await page.goto('/admin/finance?panel=tax');
      await row.getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?').fill('0,00');
      await row.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Grenze gespeichert.')).toBeVisible();
    }
  });

  test('die Matrix nennt je Rolle die Navigationseinträge, die sie sieht', async ({ page }) => {
    await page.goto('/admin/finance?panel=permissions');
    // Reihenfolge wie das Manifest: Abschnitt „Arbeit“ (F5: Arbeitsliste und Nebenlisten vor den Auszügen),
    // dann „Buchungen“, dann „Spenden“ (F6a), zuletzt die Verwaltung.
    const treasurer = page.getByTestId('permission-role-Schatzmeister');
    await expect(treasurer.getByText(/^Sichtbare Navigationseinträge:/)).toHaveText('Sichtbare Navigationseinträge: Arbeitsliste, Fremdes Geld, Belege ohne Buchung, Regeln, Hochgeladene Auszüge, Journal, Bankkonten und Kassen, Offene Zahlungen, Barkasse, Bestätigungen, Bescheide, Finanzen einrichten');

    const auditor = page.getByTestId('permission-role-Kassenprüfer');
    await expect(auditor.getByText(/^Sichtbare Navigationseinträge:/)).toHaveText('Sichtbare Navigationseinträge: Arbeitsliste, Fremdes Geld, Belege ohne Buchung, Regeln, Hochgeladene Auszüge, Journal, Bankkonten und Kassen, Offene Zahlungen, Barkasse, Bestätigungen, Bescheide');

    const clerk = page.getByTestId('permission-role-Auslagen einreichen');
    await expect(clerk.getByText(/^Sichtbare Navigationseinträge:/)).toHaveText('Sichtbare Navigationseinträge: keine');
  });

  test('die Matrix nennt je Rolle, wer sie trägt, und „niemand“ als Wort', async ({ page }) => {
    await page.goto('/admin/finance?panel=permissions');
    const treasurer = page.getByTestId('permission-role-Schatzmeister');
    await expect(treasurer).toBeVisible();
    await expect(treasurer.getByText('niemand')).toBeVisible();
    const admin = page.getByTestId('permission-role-Administration');
    await expect(admin.getByText('Anna Berger')).toBeVisible();
  });
});
