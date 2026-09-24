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
    await expect(detail.getByText('Dieser Umsatz passt zu Ihrem Entwurf vom 2026-02-14.')).toBeVisible();
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
    await expect(page.getByTestId('bound-money-line')).toHaveText('Kontoumsatz vom 2026-01-10 · −35,00 €');
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
