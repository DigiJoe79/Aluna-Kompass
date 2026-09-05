import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('site facts: numbers, donation boxes, blocked terms and featured selection', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/website/facts');
  await page.getByLabel('Weiterleitungsquote (%)').fill('97.2');
  await page.getByLabel('Hunde im Shelter').fill('150');
  await page.getByRole('button', { name: 'Standort hinzufügen' }).click();
  await page.getByLabel('Standort 1').fill('Köln-Porz');
  await page.getByRole('button', { name: 'Sperrwort hinzufügen' }).click();
  await page.getByLabel('Sperrwort 1').fill('Popescu');
  await page.getByLabel('Betterplace-Meta-Projekt-ID').fill('999999');
  await expect(page.getByText(/Änderungen noch nicht gespeichert/)).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Site-Fakten gespeichert');
  await page.reload();
  await expect(page.getByLabel('Hunde im Shelter')).toHaveValue('150');
  await expect(page.getByLabel('Standort 1')).toHaveValue('Köln-Porz');
  await expect(page.getByLabel('Sperrwort 1')).toHaveValue('Popescu');
  await expect(page.getByLabel('Hund auf der Startseite')).toHaveValue('auto');
});
