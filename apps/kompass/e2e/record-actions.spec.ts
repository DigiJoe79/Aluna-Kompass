import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Nach dem Schließen eines Dialogs aus „Weitere Aktionen“ liegt der Fokus wieder auf ⋯ (Designer 2026-10-08): Das
 * Menü ist schon zu, wenn der Dialog aufgeht, deshalb reicht `RecordActions` den Auslöser als `finalFocus` an die
 * Dialoge der Seite. Jeder Aufrufer steht hier mit einem Fall; `open` führt auf die Seite.
 */
const firstRow = async (page: Page, path: string) => {
  await page.goto(path);
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await page.waitForURL(new RegExp(`${path}/[A-Z0-9]+$`));
};

const CASES: { name: string; open: (page: Page) => Promise<void>; item: RegExp }[] = [
  { name: 'Projekt', open: (page) => firstRow(page, '/projects'), item: /Projekt löschen/ },
  { name: 'Tier', open: (page) => firstRow(page, '/animals'), item: /Tierprofil löschen/ },
  {
    name: 'Webseiten-Eintrag',
    open: async (page) => {
      await page.goto('/site/template');
      await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
      await page.getByRole('button', { name: 'Übernehmen' }).click();
      await expect(page.getByRole('status')).toContainText('eingelesen');
      await page.goto('/site/c/news');
      await page.getByRole('row').first().getByRole('link').click();
      await page.waitForURL(/\/site\/c\/news\/[A-Z0-9]+$/);
    },
    item: /Eintrag löschen/,
  },
  {
    name: 'Theme',
    open: async (page) => {
      await page.goto('/admin/themes');
      await page.getByRole('button', { name: 'Duplizieren' }).click();
      await page.getByRole('dialog').getByLabel('Schlüssel').fill('fokus');
      await page.getByRole('dialog').getByLabel('Name').fill('Fokus');
      await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
      await page.getByRole('button', { name: /^Fokus/ }).click();
    },
    item: /Theme löschen/,
  },
  { name: 'Partner', open: (page) => firstRow(page, '/finance/partners'), item: /Löschen …/ },
  { name: 'Kontakt', open: (page) => firstRow(page, '/contacts'), item: /Kontakt löschen/ },
  {
    name: 'Akte',
    open: async (page) => {
      await page.goto('/dms');
      await page.getByRole('link', { name: 'Einladung zur ordentlichen Mitgliederversammlung' }).click();
      await page.waitForURL(/\/dms\/[0-9A-Z]{26}$/);
    },
    item: /Stornieren/,
  },
  {
    name: 'Buchung',
    open: async (page) => {
      await page.goto('/finance/entries');
      await page.locator('tr', { hasText: 'Ausgabe Sommerfest' }).click();
      await page.waitForURL(/\/finance\/entries\/[0-9A-Z]{26}$/);
    },
    item: /Zurücknehmen/,
  },
  {
    name: 'Partnerzahlung, Entwurf',
    open: async (page) => {
      await page.goto('/finance/partners');
      await page.getByRole('row').nth(1).getByRole('link').first().click();
      await page.getByTestId('partner-new-payment').click();
      await page.waitForURL(/\/payments\/[0-9A-Z]{26}$/);
    },
    item: /Entwurf löschen/,
  },
  {
    name: 'Zweck',
    open: async (page) => {
      await page.goto('/finance/purposes');
      // Ein Zweck mit Bestand: „Als erfüllt kennzeichnen …“ fragt dann nach (ohne Rest liefe es ohne Dialog).
      const withBalance = page.getByTestId('purpose-row').filter({ hasNotText: /0,00 €\s*$/ }).first();
      await withBalance.getByRole('button').first().click();
      await expect(page.getByTestId('purpose-detail')).toBeVisible();
    },
    item: /Als erfüllt kennzeichnen …|Wieder öffnen …/,
  },
];

test.describe('Weitere Aktionen: Fokus zurück auf ⋯', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await c.open(page);
      const trigger = page.getByRole('button', { name: 'Weitere Aktionen' });
      await trigger.click();
      await page.getByRole('menuitem', { name: c.item }).click();
      await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });
  }
});

/** Im Fuß eines Dialogs ist eine einzelne Aktion ein Knopf statt ⋯ (Spec Seitenkopf § 3.3); der Fokus kehrt auf ihn zurück. */
test.describe('Aktion links im Dialogfuß: Fokus zurück', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Medium', async ({ page }) => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'fokus.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('row', { name: /fokus-/ }).click();
    const trigger = page.getByRole('dialog').getByRole('button', { name: 'Löschen …' });
    await trigger.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
