import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { associationYear } from './association-day';
import { resetDatabase, rowAction, setE2EDatedValue } from './helpers';
import { nextWorkingDay } from '../../../packages/modules/finance/src/ledger/working-days';

/**
 * F3b Task 5 — Finanzen einrichten (H1–H8). Die ganze Spec läuft auf einer
 * frisch aus dem Setup-Assistenten entstandenen Installation ohne
 * Finanzdaten (Muster `finance.spec.ts`: „ohne Konten zeigt die Seite einen
 * leeren Zustand…“) — so zeigt die Checkliste „alles offen“, und jede
 * Ablehnung entsteht ohne fremde Vorbedingungen.
 *
 * Ohne Seed gibt es kein Stichjahr: Alle Daten rechnen vom heutigen Vereinstag aus (`associationYear`), nicht mit
 * `story()` und nicht auf einer festen Jahreszahl — so läuft die Spec an jedem Kalendertag (0.2.7, Punkt 5).
 */
/** Ein Tag `MM-DD` im laufenden Jahr des Vereins, `years` Jahre verschoben. */
const thisYear = (monthDay: string, years = 0): string => `${associationYear() + years}-${monthDay}`;
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

/**
 * Befund 43: Verzögert jeden RSC-Abruf — so bleibt nach dem Speichern das
 * Fenster offen, in dem `router.refresh()` noch nicht zurück ist. Wer die
 * Version erst aus dem Refresh nimmt, trifft beim zweiten Speichern `staleVersion`.
 */
async function delayRefresh(page: Page): Promise<() => Promise<void>> {
  const matches = (url: URL) => url.searchParams.has('_rsc');
  await page.route(matches, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => undefined);
  });
  return () => page.unroute(matches);
}

test.describe('finance setup', () => {
  /**
   * Befund 43 je Panel: Jedes Panel übernimmt die Version aus der Antwort, nicht erst aus dem Refresh — zweimal
   * speichern (und beim Zweck gleich als erfüllt markieren), bevor der verzögerte Refresh zurück ist.
   */
  const VERSION_CASES: { panel: string; create: (page: Page) => Promise<Locator>; after?: (page: Page, row: Locator) => Promise<void> }[] = [
    {
      panel: 'accounts',
      create: async (page) => {
        await page.getByRole('button', { name: 'Konto anlegen' }).click();
        const create = page.getByRole('dialog');
        await create.getByLabel('Name').fill('Vereinskonto');
        await create.getByLabel('IBAN').fill('DE23999999990000202051');
        await create.getByRole('button', { name: 'Speichern' }).click();
        const row = page.getByTestId('account-row-Vereinskonto');
        await expect(row).toBeVisible();
        return row;
      },
    },
    {
      panel: 'purposes',
      create: async (page) => {
        await page.getByRole('button', { name: 'Zweck anlegen' }).click();
        await page.getByRole('dialog').getByLabel('Name').fill('Neues Katzenhaus');
        await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
        const row = page.locator('tr', { hasText: 'Neues Katzenhaus' });
        await expect(row).toBeVisible();
        return row;
      },
      after: async (page, row) => {
        await rowAction(page, row, 'Als erfüllt markieren');
        await expect(row.getByText('Erfüllt', { exact: true })).toBeVisible();
      },
    },
    {
      panel: 'fiscalYears',
      create: async (page) => {
        await page.getByRole('button', { name: 'Erstes Geschäftsjahr anlegen' }).click();
        const create = page.getByRole('dialog');
        await create.getByLabel('Beginnt am').fill(thisYear('01-01'));
        await create.getByLabel('Endet am').fill(thisYear('12-31'));
        await create.getByRole('button', { name: 'Speichern' }).click();
        const row = page.getByTestId('fiscal-years-panel').getByRole('row').nth(1);
        await expect(row.getByRole('button', { name: /^Aktionen für / })).toBeVisible();
        return row;
      },
    },
  ];

  test('Konten, Zwecke und Geschäftsjahre übernehmen die Version aus der Antwort: zweimal speichern vor dem Refresh', async ({ page }) => {
    for (const c of VERSION_CASES) {
      await page.goto(`/admin/finance?panel=${c.panel}`);
      const row = await c.create(page);
      const undelay = await delayRefresh(page);
      for (let i = 0; i < 2; i += 1) {
        await rowAction(page, row, 'Bearbeiten');
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Speichern' }).click();
        await expect(dialog).toBeHidden();
      }
      await c.after?.(page, row);
      await expect(page.getByText(/wurde inzwischen geändert/), c.panel).toHaveCount(0);
      await undelay();
    }
  });

  test.beforeEach(async ({ page }) => {
    await setupEmptyFinance(page);
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

    await rowAction(page, page.getByTestId('account-row-Vereinskonto'), 'Bearbeiten');
    dialog = page.getByRole('dialog');
    // Das Hauptkonto hat keinen Eintrag zum Stilllegen, sondern den Grund als Hinweis im Kopf (Spec Seitenkopf § 3.4).
    await expect(dialog.getByRole('button', { name: 'Stilllegen' })).toHaveCount(0);
    await expect(dialog).toContainText('Das Hauptkonto lässt sich nicht stilllegen oder löschen.');
  });

  test('ein Konto ohne Buchungen lässt sich links im Dialogfuß stilllegen, mit „Rückgängig“, und wieder aktivieren', async ({ page }) => {
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Spendenkonto ohne Buchungen');
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Konto angelegt.')).toBeVisible();

    await rowAction(page, page.getByTestId('account-row-Spendenkonto ohne Buchungen'), 'Bearbeiten');
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('button', { name: 'Stilllegen' }).click();
    await expect(editDialog).toBeHidden();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).toContainText('stillgelegt');
    // Ohne Rückfrage, aber mit „Rückgängig“; der Gegenweg steht danach dauerhaft im Dialog.
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Konto stillgelegt.' });
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).not.toContainText('stillgelegt');
    await rowAction(page, page.getByTestId('account-row-Spendenkonto ohne Buchungen'), 'Bearbeiten');
    await page.getByRole('dialog').getByRole('button', { name: 'Stilllegen' }).click();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).toContainText('stillgelegt');
    await rowAction(page, page.getByTestId('account-row-Spendenkonto ohne Buchungen'), 'Bearbeiten');
    await expect(page.getByRole('dialog').getByText('Stillgelegt', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Wieder aktivieren' }).click();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).not.toContainText('stillgelegt');
    await rowAction(page, page.getByTestId('account-row-Spendenkonto ohne Buchungen'), 'Bearbeiten');
    await page.getByRole('dialog').getByRole('button', { name: 'Stilllegen' }).click();
    await expect(page.getByTestId('account-row-Spendenkonto ohne Buchungen')).toContainText('stillgelegt');

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
    // Rechtegruppen sind zugeklappt, teilweise gesetzte offen (Runde 3, 158).
    await page.getByRole('button', { name: 'Alle aufklappen' }).click();
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
    // Rechtegruppen sind zugeklappt, teilweise gesetzte offen (Runde 3, 158).
    await page.getByRole('button', { name: 'Alle aufklappen' }).click();
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
    await expect(row.getByText('DE23 9999 9999 0000 2020 51')).toBeVisible();
  });

  test('„Konten einrichten“ führt aus der Kontenübersicht in das Konten-Panel', async ({ page }) => {
    await page.goto('/finance/accounts');
    await page.getByRole('link', { name: 'Konten einrichten' }).click();
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
    // Offen ist der Normalzustand: in der Liste ohne Marke (Designer Stufe 2 Nr. 6a). Die Zustandswechsel stehen im
    // ⋯-Menü der Zeile (Joe 11.8).
    const menu = row.getByRole('button', { name: /^Aktionen für / });
    await expect(row.getByText('Offen', { exact: true })).toHaveCount(0);
    await rowAction(page, row, 'Als erfüllt markieren');
    await expect(row.getByText('Erfüllt', { exact: true })).toBeVisible();
    await menu.click();
    await expect(page.getByRole('menuitem', { name: 'Als erfüllt markieren' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Auflösen' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Wieder öffnen' }).click();
    const reopenDialog = page.getByRole('dialog');
    await reopenDialog.getByLabel('Begründung').fill('Doch noch Bedarf');
    await reopenDialog.getByRole('button', { name: 'Wieder öffnen' }).click();
    await expect(reopenDialog).toBeHidden();
    await expect(row.getByText('Offen', { exact: true })).toHaveCount(0);
    await menu.click();
    await expect(page.getByRole('menuitem', { name: 'Als erfüllt markieren' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Wieder öffnen' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('die Besteuerungsform steht als Zeitreihe mit Erklärsatz unter „Sätze und Grenzen“', async ({ page }) => {
    await page.goto('/admin/finance?panel=datedValues');
    const panel = page.getByTestId('dated-values-panel');
    await expect(panel.getByText('Besteuerungsform', { exact: true })).toBeVisible();
    await expect(panel.getByText('Die Besteuerungsform gilt taggenau — eine Änderung wirkt ab dem gewählten Stichtag.')).toBeVisible();
    // Der jüngste Stichtag ist der Stand; ein eigenes „Aktuell: …“ gibt es nicht mehr (11-1 B30).
    await expect(panel.getByText(/^(Kleinunternehmer|Regelbesteuerung)/).first()).toBeVisible();

    await page.getByTestId('dated-value-menu-taxation').click();
    await page.getByTestId('dated-value-edit-taxation').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gültig ab').fill(thisYear('01-01', 1));
    await dialog.getByLabel('Sätze und Grenzen').selectOption('regular');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByText('Vom Verein überschrieben')).toBeVisible();
    // N3 Nachtrag A: der Stichtag steht im deutschen Format, nicht mehr roh als ISO.
    await expect(panel.getByText(`01.01.${associationYear() + 1}`)).toBeVisible();
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
    // Fund k (F8b): Wer vor dem Ende des Refreshs erneut öffnet, darf keine alte Version haben.
    // Die Verzögerung macht das Fenster breit, das sonst nur unter Last aufgeht.
    await page.route(
      (url) => url.searchParams.has('_rsc'),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue().catch(() => undefined);
      },
    );
    await rowAction(page, row, 'Bearbeiten');
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Kategorie geändert.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await rowAction(page, row, 'Bearbeiten');
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Aktiv').uncheck();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByText('stillgelegt')).toBeVisible();
  });

  test('Kategorien: Suche in der Adresse, Zählzeile, ohne Treffer steht „Filter zurücksetzen“', async ({ page }) => {
    await page.goto('/admin/finance?panel=categories');
    const search = page.getByRole('searchbox', { name: 'Suchen' });
    await search.fill('zzz');
    await expect(page).toHaveURL(/panel=categories&text=zzz$/);
    await expect(page.getByText(/^0 von \d+ Kategorien$/)).toBeVisible();
    await expect(page.getByText('Keine Kategorie passt zu diesen Filtern.')).toBeVisible();
    await page.reload();
    await expect(search).toHaveValue('zzz');
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).last().click();
    await expect(search).toHaveValue('');
    await expect(page).toHaveURL(/panel=categories$/);
    await expect(page.getByTestId('category-row-office')).toBeVisible();
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
    // Das Jahr muss heute enthalten: Die Buchung unten läuft auf heute, sonst legte sie ein zweites Geschäftsjahr an.
    const year = associationYear();
    await page.goto('/admin/finance?panel=fiscalYears');
    await page.getByRole('button', { name: 'Erstes Geschäftsjahr anlegen' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Beginnt am').fill(`${year}-01-01`);
    await dialog.getByLabel('Endet am').fill(`${year}-12-31`);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Geschäftsjahr angelegt.')).toBeVisible();

    // Ein Konto mit Anfangsbestand bucht die erste Buchungsnummer des Jahres.
    await page.goto('/admin/finance?panel=accounts');
    await page.getByRole('button', { name: 'Konto anlegen' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Vereinskonto');
    await dialog.getByLabel('IBAN').fill('DE23999999990000202051');
    await dialog.getByLabel('Anfangsbestand').fill('100,00');
    await dialog.getByLabel('Stichtag').fill(`${year}-01-01`);
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
    await rowAction(page, page.getByTestId('fiscal-years-panel').getByRole('row').nth(1), 'Bearbeiten');
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Bezeichnung').fill('Anders');
    await editDialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Bezeichnung');
  });

  test('ein Rumpfjahr bekommt nur das Jahr des Beginns als Bezeichnung, mit dem Kennzeichen daneben (Befund 15)', async ({ page }) => {
    await page.goto('/admin/finance?panel=fiscalYears');
    await page.getByRole('button', { name: 'Erstes Geschäftsjahr anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Beginnt am').fill(thisYear('03-15'));
    await dialog.getByLabel('Endet am').fill(thisYear('12-31'));
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Geschäftsjahr angelegt.')).toBeVisible();

    const year = associationYear();
    const row = page.getByRole('row', { name: new RegExp(String(year)) });
    await expect(row.getByText(String(year), { exact: true })).toBeVisible();
    await expect(row.getByText(`Rumpfjahr (15.03.${year}–31.12.${year})`)).toBeVisible();
  });

  test('die Anspruchsgrundlage für Aufwandsspenden steht nur bei eingeschaltetem Schalter und hakt den Schritt der Checkliste ab', async ({ page }) => {
    await page.goto('/admin/finance?panel=tax');
    const panel = page.getByTestId('tax-panel');
    await expect(panel.getByLabel('Anspruchsgrundlage für Aufwandsspenden')).toHaveCount(0);
    // Runde 3, 172: Die Schalter gelten mit der Leiste des Abschnitts; der Abschnitt der Grundlage erscheint danach.
    const switches = panel.getByTestId('tax-switches');
    await switches.getByRole('radiogroup', { name: 'Werden Aufwandsspenden angeboten?' }).getByRole('radio', { name: 'Ja' }).click();
    await switches.getByTestId('tax-switches-save').click();
    await expect(page.getByText('Schalter gespeichert.')).toBeVisible();
    const waiver = panel.getByTestId('waiver-basis');
    const field = waiver.getByLabel('Anspruchsgrundlage für Aufwandsspenden');
    await expect(field).toBeVisible();
    await expect(waiver).toContainText('Vereinbarung vom … / Satzung § …');
    await field.fill('Satzung § 9 Abs. 2');
    // Befund J: ohne „Gilt ab“ nennt der Dienst das Feld; der Knopf ist nie ausgegraut (K9-Befund 10, MUSTER § B).
    await waiver.getByTestId('waiver-basis-save').click();
    await expect(waiver.getByLabel('Gilt ab')).toHaveAttribute('aria-invalid', 'true');
    await waiver.getByLabel('Gilt ab').fill(thisYear('01-01'));
    await waiver.getByTestId('waiver-basis-save').click();
    await expect(page.getByText('Anspruchsgrundlage gespeichert.')).toBeVisible();

    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-waiverBasis')).toHaveAttribute('data-done', 'true');
    await page.goto('/admin/finance?panel=tax');
    await expect(page.getByTestId('tax-panel').getByLabel('Anspruchsgrundlage für Aufwandsspenden')).toHaveValue('Satzung § 9 Abs. 2');
    await expect(page.getByTestId('waiver-basis').getByLabel('Gilt ab')).toHaveValue(thisYear('01-01'));
  });

  test('Barkasse und Journal ohne Einrichtung: Seitenkopf, leerer Zustand und der Weg zum Einrichten (K9-Befund 6)', async ({ page }) => {
    await page.goto('/finance/cash');
    await expect(page.getByRole('heading', { name: 'Kassen', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Noch keine Barkasse' })).toBeVisible();
    // Kein gesperrter Schritt, sondern noch nichts da (MUSTER Seitenrahmen).
    await expect(page.getByText('nicht möglich', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Barkasse einrichten' })).toHaveAttribute('href', '/admin/finance?panel=accounts');

    // Dasselbe im Journal: ohne Geschäftsjahr und Konto ein leerer Zustand mit dem Weg zur Checkliste.
    await page.goto('/finance/entries');
    await expect(page.getByRole('heading', { name: 'Journal', level: 1 })).toBeVisible();
    await expect(page.getByText('nicht möglich', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Finanzen einrichten' })).toHaveAttribute('href', '/admin/finance?panel=checklist');
  });

  test('Freigaben ohne wartende Anträge: nur der leere Zustand unter dem Seitenkopf (K9-Befund 7)', async ({ page }) => {
    await page.goto('/finance/approvals');
    await expect(page.getByRole('heading', { name: 'Freigaben', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nichts wartet auf Ihre Freigabe' })).toBeVisible();
    // Keine leere Schlange mit Überschrift und keine leere Detailspalte daneben.
    await expect(page.getByTestId('approval-queue')).toHaveCount(0);
    await expect(page.getByTestId('approval-detail')).toHaveCount(0);
  });

  test('Pauschalen an Vorstandsmitglieder: eigener Abschnitt mit Speicherleiste, „Gilt ab“ meldet der Dienst am Feld (K9-Befund 2/3)', async ({ page }) => {
    await page.goto('/admin/finance?panel=tax');
    const panel = page.getByTestId('tax-panel');
    await expect(panel.getByRole('heading', { name: 'Pauschalen an Vorstandsmitglieder', level: 2 })).toBeVisible();
    const form = panel.getByTestId('board-remuneration');
    // Joe 11.9: eine Ja/Nein-Frage ohne Vorauswahl; Fundstelle und „Gilt ab“ erst bei „Ja“.
    await expect(form.getByLabel('Satzungsfundstelle')).toHaveCount(0);
    await form.getByRole('radio', { name: 'Ja' }).click();
    await form.getByLabel('Satzungsfundstelle').fill('Satzung § 7 Abs. 3');
    // Speichern ist nie ausgegraut (MUSTER § B); das fehlende Datum nennt der Dienst am Feld.
    const save = form.getByTestId('board-remuneration-save');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(form.getByText('Pflichtfeld.')).toBeVisible();
    await form.getByLabel('Gilt ab').fill(thisYear('01-01'));
    await save.click();
    await expect(form.getByText('Pflichtfeld.')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('board-remuneration').getByLabel('Satzungsfundstelle')).toHaveValue('Satzung § 7 Abs. 3');
    await expect(page.getByTestId('board-remuneration').getByLabel('Gilt ab')).toHaveValue(thisYear('01-01'));
  });

  test('Umsatzsteuer: ein Stand mit Dauerfristverlängerung verschiebt die Voranmeldung, Entfernen holt sie zurück (E6a Task 11d)', async ({ page }) => {
    // Das Vorjahr: Sein drittes Quartal hat an jedem Kalendertag schon begonnen. Regelbesteuerung → jedes Quartal hat eine Frist.
    const lastYear = associationYear() - 1;
    await page.goto('/admin/finance?panel=fiscalYears');
    await page.getByRole('button', { name: 'Erstes Geschäftsjahr anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Beginnt am').fill(`${lastYear}-01-01`);
    await create.getByLabel('Endet am').fill(`${lastYear}-12-31`);
    await create.getByRole('button', { name: 'Speichern' }).click();
    await expect(create).toBeHidden();
    await setE2EDatedValue(page, 'taxation', `${lastYear}-01-01`, 'regular');

    const q3 = async (): Promise<string> => {
      await page.goto('/finance/deadlines');
      const row = page.getByTestId('deadline-row').filter({ hasText: `Umsatzsteuer-Voranmeldung Q3 ${lastYear}` });
      await expect(row).toHaveCount(1);
      return (await row.getByRole('cell').first().textContent()) ?? '';
    };
    const asShown = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    expect(await q3()).toBe(asShown(nextWorkingDay(`${lastYear}-10-10`)));

    await page.goto('/admin/finance?panel=vat');
    const panel = page.getByTestId('vat-panel');
    await panel.getByLabel('Gilt ab').fill(`${lastYear}-07-01`);
    await panel.getByRole('radiogroup', { name: 'Dauerfristverlängerung' }).getByRole('radio', { name: 'Ja' }).click();
    await panel.getByTestId('vat-settings-save').click();
    const stand = panel.getByTestId('vat-history-row').filter({ hasText: `01.07.${lastYear}` });
    await expect(stand).toBeVisible();
    expect(await q3()).toBe(asShown(nextWorkingDay(`${lastYear}-11-10`)));

    await page.goto('/admin/finance?panel=vat');
    await rowAction(page, page.getByTestId('vat-history-row').filter({ hasText: `01.07.${lastYear}` }), 'Entfernen …');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Entfernen' }).click();
    await expect(page.getByTestId('vat-history-row')).toHaveCount(0);
    expect(await q3()).toBe(asShown(nextWorkingDay(`${lastYear}-10-10`)));
  });

  test('einen Satz ab Stichtag überschreiben und wieder zurücknehmen', async ({ page }) => {
    await page.goto('/admin/finance?panel=datedValues');
    await page.getByTestId('dated-value-menu-vatStandard').click();
    await page.getByTestId('dated-value-edit-vatStandard').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gültig ab').fill(thisYear('01-01', 1));
    await dialog.getByLabel('Wert').fill('21');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Vom Verein überschrieben')).toBeVisible();

    await rowAction(page, page.getByTestId('dated-value-row').filter({ hasText: 'Vom Verein überschrieben' }), 'Zurücknehmen');
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
      // Runde 3, 172: eine Leiste für alle Grenzen; ohne Änderung meldet sie „Nichts geändert“, statt ausgegraut zu sein.
      const save = page.getByTestId('tax-limits-save');
      await save.click();
      await expect(page.getByTestId('tax-limits').getByText('Nichts geändert')).toBeVisible();
      await row.getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?').fill('50,00');
      await save.click();
      await expect(page.getByText('Grenze gespeichert.')).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('tax-limit-statement-suffices').getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?')).toHaveValue('50,00');
    } finally {
      await page.goto('/admin/finance?panel=tax');
      await row.getByLabel('Bis zu welchem Betrag genügt der Kontoauszug als Beleg?').fill('0,00');
      await page.getByTestId('tax-limits-save').click();
      await expect(page.getByText('Grenze gespeichert.')).toBeVisible();
    }
  });

  // Runde 3 (Designer Frage 4, 173): „Wer darf was“ ist eine Liste je Tätigkeit mit „erteilt an …“; Navigation und
  // Träger stehen nicht mehr hier (Träger im Rolleneditor).
  test('„Wer darf was“ nennt je Tätigkeit die Rollen, denen sie erteilt ist', async ({ page }) => {
    await page.goto('/admin/finance?panel=permissions');
    const rows = page.getByTestId('permission-activity');
    await expect(rows.filter({ hasText: 'Finanzen lesen' })).toContainText(/erteilt an .*Schatzmeister/);
    await expect(page.getByText('Sichtbare Navigationseinträge')).toHaveCount(0);
    await expect(page.getByText('Trägt diese Rolle')).toHaveCount(0);
  });
});
