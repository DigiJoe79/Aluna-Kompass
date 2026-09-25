import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F5 Task 7 — die Arbeitsliste (`/finance/work`, HANDOFF § 12.5 B1). Läuft auf
 * dem eigens gesäten Konto „Importkonto“: Dort warten nach dem Seed zwei
 * offene Kontoumsätze — „Bueromaterial“ (Regel „Büromaterial“, sicher) und
 * „Zuschuss“ (passt zum Entwurf „Zuschuss“ ohne Kontoumsatz, Vorschlag 0) —,
 * und ein Agent hat „Spende April“ über MCP als Entwurf vorbereitet.
 */
test.describe('finance work list', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  async function openWorkList(page: Page) {
    await page.goto('/finance/work');
    await page.getByLabel('Liste für Konto').selectOption({ label: 'Importkonto' });
    await expect(page).toHaveURL(/account=/);
    await expect(page.getByRole('listbox', { name: 'Kontoumsätze' }).getByRole('option').first()).toBeVisible();
  }

  const option = (page: Page, text: string) => page.getByRole('listbox', { name: 'Kontoumsätze' }).getByRole('option').filter({ hasText: text });

  test('die Arbeitsliste zählt die Reiter und zeigt offene Kontoumsätze mit ihrem Vorschlag', async ({ page }) => {
    await loginAsAdmin(page);
    await openWorkList(page);
    for (const name of ['Zuzuordnen', 'Unsicher', 'Vom Agenten vorbereitet', 'Geprüft, nicht festgeschrieben', 'Fällig']) {
      await expect(page.getByRole('tab', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByTestId('work-count-agent')).toHaveText('1');
    await expect(page.getByRole('tab', { name: /Zuzuordnen/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/zurückgehaltene Zeilen? warte/)).toBeVisible();

    await expect(option(page, 'Buerobedarf Muster GmbH')).toBeVisible();
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toBeVisible();
    // Gebunden an den Agenten-Entwurf — steht nicht mehr unter „Zuzuordnen“.
    await expect(option(page, 'Spende April')).toHaveCount(0);
    // Der älteste Umsatz ist gewählt; rechts steht er im Klartext mit seinem Vorschlag.
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await expect(detail.getByText('DE12999999990000112233')).toBeVisible();
    await expect(detail.getByTestId('suggestion-reasons')).toContainText('Vorschlag, weil:');

    // Der Reiter steht in der Adresse — ein Neuladen bleibt dort.
    await page.getByRole('tab', { name: /Vom Agenten vorbereitet/ }).click();
    await expect(page).toHaveURL(/tab=agent/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /Vom Agenten vorbereitet/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('„Vorschlag, weil:“ nennt die Regel; Enter übernimmt als geprüft und springt weiter; die aria-live-Zeile nennt die verbleibenden', async ({ page }) => {
    await loginAsAdmin(page);
    await openWorkList(page);
    const reasons = page.getByTestId('suggestion-reasons');
    await expect(reasons).toContainText('Vorschlag, weil:');
    await expect(reasons).toContainText('Regel „Büromaterial“');
    await expect(reasons).toHaveClass(/bg-agent-bg/);
    // Die Mini-Maske ist vorbelegt: die Kategorie aus der Regel, schmale Aufteilungszeile.
    await expect(page.getByTestId('work-detail').getByTestId('split-row')).toHaveAttribute('data-density', 'narrow');

    await page.keyboard.press('Enter');
    const live = page.getByTestId('work-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toContainText(/\d+ Umsätze? warte[nt] auf Zuordnung/);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toHaveAttribute('aria-selected', 'true');

    // Der übernommene Umsatz ist ein geprüfter Entwurf.
    await page.getByRole('tab', { name: /Geprüft, nicht festgeschrieben/ }).click();
    await expect(page.getByTestId('work-entry').filter({ hasText: 'Büromaterial' })).toBeVisible();
  });

  test('ein Umsatz, der zu einer Handbuchung passt, bietet Verknüpfen statt einer Maske', async ({ page }) => {
    await loginAsAdmin(page);
    await openWorkList(page);
    await option(page, 'Foerderverein Musterstadt e. V.').click();
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await expect(detail.getByText('Dieser Umsatz passt zu Ihrem Entwurf vom 14.02.2026.')).toBeVisible();
    await expect(detail.getByRole('button', { name: /Übernehmen und geprüft/ })).toHaveCount(0);
    await expect(detail.getByTestId('split-row')).toHaveCount(0);
    await detail.getByRole('button', { name: 'Verknüpfen' }).click();
    await expect(page.getByText('Kontoumsatz verknüpft.')).toBeVisible();
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toHaveCount(0);
  });

  test('E öffnet die volle Maske mit Konto, Betrag und Kontoumsatz vorbelegt', async ({ page }) => {
    await loginAsAdmin(page);
    await openWorkList(page);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('e');
    await expect(page).toHaveURL(/\/finance\/entries\/new\?raw=[0-9A-Z]{26}&back=work$/);
    await expect(page.getByTestId('bound-money-line')).toHaveText('Kontoumsatz vom 10.01.2026 · −35,00 €');
    await expect(page.getByTestId('bound-money-line')).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Büromaterial');
    await expect(page.getByRole('radio', { name: 'Ausgabe' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('split-row').getByLabel('Kategorie')).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Speichern und als geprüft markieren' }).click();
    await expect(page).toHaveURL(/\/finance\/work/);
    await page.getByLabel('Liste für Konto').selectOption({ label: 'Importkonto' });
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toBeVisible();
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);
  });

  test('eine stillgelegte Kategorie in der Regel wird gemeldet und verlinkt die Einrichtung', async ({ page }) => {
    await loginAsAdmin(page);
    await openWorkList(page);
    // Der Dezember-Auszug trifft die Seed-Regel „Bürobedarf Dezember“, deren Kategorie stillgelegt ist.
    await page.getByTestId('statement-file-input').setInputFiles(path.resolve(import.meta.dirname, 'fixtures/camt/mehrere-b.xml'));
    await expect(page.getByText(/1 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    await option(page, 'Bueromaterial Dezember').click();
    await expect(option(page, 'Bueromaterial Dezember')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await expect(detail.getByTestId('suggestion-reasons')).toContainText('Regel „Bürobedarf Dezember“');
    const problem = detail.getByRole('alert');
    await expect(problem).toContainText('Die Kategorie dieses Vorschlags ist stillgelegt.');
    await expect(problem.getByRole('link', { name: 'Kategorien einrichten' })).toHaveAttribute('href', '/admin/finance?panel=categories');
  });

  test('ohne finance.entriesWrite sieht man Liste und Vorschlag, aber keine Kürzel und keine Knöpfe', async ({ page }) => {
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

    await openWorkList(page);
    await expect(page.getByTestId('suggestion-reasons')).toContainText('Regel „Büromaterial“');
    await expect(page.getByTestId('work-keys')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Übernehmen und geprüft/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ändern/ })).toHaveCount(0);
    await expect(page.getByTestId('statement-file-input')).toHaveCount(0);
    // Die Tasten tun nichts: Enter bucht nicht.
    await page.keyboard.press('Enter');
    await expect(option(page, 'Buerobedarf Muster GmbH')).toBeVisible();
    await expect(page).toHaveURL(/\/finance\/work/);
  });

  test('der Reiter „Vom Agenten vorbereitet“ zeigt den MCP-Entwurf mit Geprüft-Knopf', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work?tab=agent');
    const row = page.getByTestId('work-entry').filter({ hasText: 'Spende April' });
    await expect(row).toBeVisible();
    await expect(row.getByText('vom Agenten vorbereitet')).toBeVisible();
    await row.getByRole('button', { name: 'Geprüft' }).click();
    await expect(page.getByTestId('work-entry').filter({ hasText: 'Spende April' })).toHaveCount(0);
    await expect(page.getByTestId('work-count-agent')).toHaveText('0');
  });
});

/**
 * F5 Task 8 — Regeln, fremdes Geld, Kontakt anlegen, Beleg von beiden Seiten,
 * Sammel-Festschreiben und die Nebenlisten. Dazu im Seed (aus Task 9
 * vorgezogen): eine Zahlung, die dem Verein nicht gehört (120,00 € für den
 * Nachbarverein), und eine Eingangsrechnung über 35,00 € ohne Buchung. Zwei
 * eigene Auszüge für „Importkonto“ liegen unter `fixtures/camt/arbeitsliste-*`.
 */
test.describe('finance work list: rules, foreign money, vouchers, batch', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  const camt = (name: string) => path.resolve(import.meta.dirname, 'fixtures/camt', name);
  const option = (page: Page, text: string) => page.getByRole('listbox', { name: 'Kontoumsätze' }).getByRole('option').filter({ hasText: text });

  async function openImportAccount(page: Page, tab?: 'unsure') {
    await page.goto(tab ? `/finance/work?tab=${tab}` : '/finance/work');
    await page.getByLabel('Liste für Konto').selectOption({ label: 'Importkonto' });
    await expect(page).toHaveURL(/account=/);
  }

  async function uploadFutter(page: Page) {
    await openImportAccount(page);
    await page.getByTestId('statement-file-input').setInputFiles(camt('arbeitsliste-futter.xml'));
    await expect(page.getByText(/2 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    // Ohne Vorschlag stehen die Futter-Umsätze unter „Unsicher“.
    await page.getByRole('tab', { name: /Unsicher/ }).click();
    await expect(page).toHaveURL(/tab=unsure/);
    await expect(option(page, 'Futter Juli')).toBeVisible();
  }

  test('„Künftig immer so?“ zeigt „trifft n frühere Umsätze, davon m anders gebucht“ und die neue Regel greift beim nächsten Umsatz', async ({ page }) => {
    await loginAsAdmin(page);
    await uploadFutter(page);
    await option(page, 'Futter Juli').click();
    await expect(option(page, 'Futter Juli')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await detail.getByTestId('split-row').getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await detail.getByRole('button', { name: /Übernehmen und geprüft/ }).click();
    await expect(page.getByText('Übernommen und als geprüft markiert.')).toBeVisible();
    await expect(option(page, 'Futter August')).toHaveAttribute('aria-selected', 'true');

    await detail.getByRole('button', { name: 'Künftig immer so?' }).click();
    const dialog = page.getByRole('dialog', { name: 'Künftig immer so?' });
    await expect(dialog.getByLabel('Text enthält')).toHaveValue('Futterhaus Beispiel KG');
    await expect(dialog.getByRole('checkbox', { name: /DE69999999990000445566/ })).toBeChecked();
    await dialog.getByLabel('Kategorie').selectOption({ label: 'Zweckausgaben' });
    await expect(dialog.getByTestId('rule-preview')).toHaveText(/trifft 2 frühere Umsätze, davon 1 anders gebucht/);
    await expect(dialog.getByRole('link', { name: 'anders gebuchte ansehen' })).toHaveAttribute('href', /\/finance\/entries\?ids=[0-9A-Z]{26}$/);
    await expect(dialog.getByText('Die Regel wirkt nur für künftige Umsätze — was schon gebucht ist, bleibt, wie es ist.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Regel speichern' }).click();
    await expect(page.getByText('Regel gespeichert.')).toBeVisible();
    await expect(dialog).toBeHidden();

    // Mit der Regel ist „Futter August“ sicher: Er steht jetzt unter „Zuzuordnen“ und nennt die Regel.
    await page.getByRole('tab', { name: /Zuzuordnen/ }).click();
    await option(page, 'Futter August').click();
    await expect(option(page, 'Futter August')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.getByTestId('suggestion-reasons')).toContainText('Regel „Futterhaus Beispiel KG“');
  });

  test('„Gehört nicht dem Verein“ verlangt den Pflichttext und der Umsatz steht unter „Fremdes Geld, noch nicht weitergegeben“', async ({ page }) => {
    await loginAsAdmin(page);
    await openImportAccount(page);
    await option(page, 'Foerderverein Musterstadt e. V.').click();
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('work-detail').getByRole('button', { name: 'Gehört nicht dem Verein' }).click();
    const dialog = page.getByRole('dialog', { name: 'Gehört nicht dem Verein' });
    // Ein Eingang zahlt nichts zurück — die Auswahl gibt es nur bei einem Ausgang.
    await expect(dialog.getByLabel('Rückzahlung von')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Als fremdes Geld buchen' }).click();
    await expect(dialog.getByText('Sagen Sie, für wen das Geld ist.')).toBeVisible();
    await dialog.getByLabel('Für wen ist das Geld?').fill('Jugendgruppe Nachbarort');
    await dialog.getByRole('button', { name: 'Als fremdes Geld buchen' }).click();
    await expect(page.getByText('Als fremdes Geld gebucht.')).toBeVisible();
    await expect(option(page, 'Foerderverein Musterstadt e. V.')).toHaveCount(0);

    await page.goto('/finance/work/foreign');
    await expect(page.getByRole('heading', { name: 'Fremdes Geld, noch nicht weitergegeben' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Jugendgruppe Nachbarort.*50,00/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Nachbarverein Beispielstadt.*120,00/ })).toBeVisible();

    // Die Weitergabe: ein Ausgang über 120,00 €, als Rückzahlung des Eingangs aus dem Seed.
    await openImportAccount(page);
    await page.getByTestId('statement-file-input').setInputFiles(camt('arbeitsliste-weitergabe.xml'));
    await expect(page.getByText(/1 neu, 0 bereits vorhanden, 0 zurückgehalten/)).toBeVisible();
    await page.getByRole('tab', { name: /Unsicher/ }).click();
    await option(page, 'Weitergabe Sammelbestellung').click();
    await expect(option(page, 'Weitergabe Sammelbestellung')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('work-detail').getByRole('button', { name: 'Gehört nicht dem Verein' }).click();
    await dialog.getByLabel('Rückzahlung von').selectOption({ label: '06.07.2026 · Nachbarverein Beispielstadt · 120,00 €' });
    await dialog.getByLabel('Für wen ist das Geld?').fill('Nachbarverein Beispielstadt');
    await dialog.getByRole('button', { name: 'Als fremdes Geld buchen' }).click();
    await expect(page.getByText('Als fremdes Geld gebucht.')).toBeVisible();

    await page.goto('/finance/work/foreign');
    await expect(page.getByRole('row', { name: /Jugendgruppe Nachbarort/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Nachbarverein Beispielstadt/ })).toHaveCount(0);
  });

  test('ein PDF auf den Umsatz legt den Beleg im Namen der Buchung ab; „Beleg suchen“ findet die Rechnung über den Betrag', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work/vouchers');
    await expect(page.getByRole('row', { name: /Rechnung Büromaterial über 35,00 €/ })).toBeVisible();

    await openImportAccount(page);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await detail.getByRole('button', { name: 'Beleg suchen' }).click();
    const hits = detail.getByRole('list', { name: 'Treffer in der Akte' });
    const hit = hits.getByRole('listitem').filter({ hasText: 'Rechnung Büromaterial über 35,00 €' });
    await expect(hit).toContainText('Betrag');
    await expect(detail.getByRole('link', { name: 'In der Akte suchen' })).toHaveAttribute('href', /^\/dms\?text=35%2C00$/);
    await hit.getByRole('button', { name: 'Verknüpfen' }).click();
    await expect(page.getByText(/Beleg ERE-[\d-]+ verknüpft\./)).toBeVisible();
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveCount(0);
    await page.goto('/finance/work/vouchers');
    await expect(page.getByRole('row', { name: /Rechnung Büromaterial über 35,00 €/ })).toHaveCount(0);

    await uploadFutter(page);
    await option(page, 'Futter Juli').click();
    await expect(option(page, 'Futter Juli')).toHaveAttribute('aria-selected', 'true');
    await detail.getByTestId('voucher-file-input').setInputFiles(path.resolve(import.meta.dirname, 'fixtures/brief-digital.pdf'));
    const confirm = detail.getByRole('group', { name: 'Beleg ablegen' });
    await expect(confirm.getByLabel('Art')).toHaveValue('voucher-invoice');
    await expect(confirm.getByLabel('Datum')).toHaveValue('2026-08-03');
    await confirm.getByRole('button', { name: 'Beleg ablegen' }).click();
    await expect(page.getByText(/Beleg ERE-[\d-]+ im Namen der Buchung abgelegt\./)).toBeVisible();
    await expect(option(page, 'Futter Juli')).toHaveCount(0);
  });

  test('Sammel-Festschreiben zeigt je Konto den neuen Buchbestand gegen den Endsaldo laut Auszug und vergibt Nummern', async ({ page }) => {
    await loginAsAdmin(page);
    await openImportAccount(page);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Übernommen und als geprüft markiert.')).toBeVisible();
    await expect(page.getByText('2 geprüft, noch nicht festgeschrieben')).toBeVisible();

    await page.getByRole('button', { name: 'Festschreiben' }).click();
    const dialog = page.getByRole('dialog', { name: 'Geprüfte Entwürfe festschreiben' });
    const importRow = dialog.getByRole('row', { name: /Importkonto/ });
    await expect(importRow).toContainText('−35,00 €');
    // Buchbestand: 1.000,00 € Anfang + 200,00 € Spende + 25,00 € Mitgliedsbeitrag August (Seed) − 35,00 €.
    await expect(importRow).toContainText('1.190,00 €');
    // Endsaldo des August-Auszugs aus dem Seed (F5 Task 9).
    await expect(importRow).toContainText('1.710,00 €');
    await expect(dialog.getByRole('status')).toContainText('Importkonto');
    await expect(dialog.getByRole('row', { name: /Vereinskonto/ })).toContainText('25,00 €');
    await expect(dialog.getByText('2 Nummern werden vergeben.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page.getByText(/Festgeschrieben: \d{4}-\d+, \d{4}-\d+\./)).toBeVisible();
    await expect(page.getByText(/geprüft, noch nicht festgeschrieben/)).toHaveCount(0);
  });

  test('„Kontakt anlegen“ übernimmt die Gegenpartei; danach schlägt die IBAN diesen Kontakt vor', async ({ page }) => {
    await loginAsAdmin(page);
    await uploadFutter(page);
    await option(page, 'Futter Juli').click();
    await expect(option(page, 'Futter Juli')).toHaveAttribute('aria-selected', 'true');
    const detail = page.getByTestId('work-detail');
    await detail.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kontakt anlegen' });
    await dialog.getByRole('radio', { name: 'Organisation' }).check();
    await expect(dialog.getByLabel('Name')).toHaveValue('Futterhaus Beispiel KG');
    await dialog.getByRole('button', { name: 'Kontakt anlegen' }).click();
    await expect(page.getByText('Kontakt Futterhaus Beispiel KG angelegt; die IBAN gehört jetzt zu ihm.')).toBeVisible();
    await expect(detail.getByTestId('suggestion-reasons')).toContainText('IBAN gehört zu Kontakt Futterhaus Beispiel KG');

    // Wer Buchungen vorbereiten, aber keine Kontakte verwalten darf, sieht, wer das Recht vergeben kann.
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Theo Vorbereiter');
    await create.getByLabel('E-Mail').fill('theo@example.org');
    await create.getByLabel('Finanz-Agent').check();
    await create.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('theo@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('theo-bereitet-nur-vor-2026');
    await page.getByLabel('Passwort wiederholen').fill('theo-bereitet-nur-vor-2026');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await openImportAccount(page);
    await expect(option(page, 'Buerobedarf Muster GmbH')).toHaveAttribute('aria-selected', 'true');
    await detail.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const blocked = page.getByRole('dialog', { name: 'Kontakt anlegen' });
    await expect(blocked.getByText('Kein Recht, Kontakte anzulegen')).toBeVisible();
    await expect(blocked.getByText(/„Kontakte verwalten“.*vergeben kann es: .*Anna Berger/)).toBeVisible();
    await expect(blocked.getByRole('button', { name: 'Kontakt anlegen' })).toHaveCount(0);
  });

  test('ein Finanzbeleg ohne Buchung wird aus der Akte zur Buchung; die Maske verknüpft ihn beim Speichern', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work/vouchers');
    await page.getByRole('link', { name: 'Rechnung Büromaterial über 35,00 €' }).click();
    await expect(page).toHaveURL(/\/dms\/[0-9A-Z]{26}$/);
    await page.getByRole('link', { name: 'Zu Buchung machen' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/new\?voucher=[0-9A-Z]{26}$/);
    const pending = page.getByTestId('pending-voucher');
    await expect(pending).toContainText('Rechnung Büromaterial über 35,00 €');
    await expect(pending).toContainText('wird verknüpft beim Speichern');

    await page.getByLabel('Text').fill('Büromaterial laut Rechnung');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('35,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Büro, Porto, Telefon' });
    await rows.nth(0).getByLabel('Betrag').fill('35,00');
    await page.getByRole('button', { name: 'Als Entwurf speichern' }).click();
    await expect(page).toHaveURL('/finance/entries');
    await expect(page.locator('tr', { hasText: 'Büromaterial laut Rechnung' }).getByRole('img', { name: 'Belegt.' })).toBeVisible();

    await page.goto('/finance/work/vouchers');
    await expect(page.getByRole('row', { name: /Rechnung Büromaterial über 35,00 €/ })).toHaveCount(0);
  });

  test('die Regel-Liste zeigt Treffer und „Kategorie stillgelegt“; Löschen fragt nach', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/work/rules');
    await expect(page.getByRole('heading', { level: 2, name: 'Regeln', exact: true })).toBeVisible();
    const december = page.getByRole('row', { name: /Bürobedarf Dezember/ });
    await expect(december).toContainText('Kategorie stillgelegt');
    const office = page.getByRole('row', { name: /Büromaterial/ }).filter({ hasNotText: 'Dezember' });
    await expect(office.getByTestId('rule-hits')).toHaveText('1');
    await expect(office).toContainText('Text enthält „bueromaterial“');

    await office.getByRole('button', { name: 'Bearbeiten' }).click();
    const dialog = page.getByRole('dialog', { name: 'Regel bearbeiten' });
    await expect(dialog.getByLabel('Name der Regel')).toHaveValue('Büromaterial');
    await expect(dialog.getByLabel('Text enthält')).toHaveValue('bueromaterial');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    await december.getByRole('button', { name: 'Löschen' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Regel löschen?' });
    await expect(confirm).toContainText('bleiben, wie sie gebucht sind');
    await confirm.getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByText('Regel gelöscht.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Bürobedarf Dezember/ })).toHaveCount(0);
  });
});
