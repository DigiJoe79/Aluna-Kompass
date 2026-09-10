import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('contacts', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a person and finds it again by name', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Anrede').fill('Frau');
    await dialog.getByLabel('Vorname').fill('Anna');
    await dialog.getByLabel('Nachname').fill('Berger');
    await dialog.getByLabel('Straße').fill('Musterweg 1');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();

    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
    await page.getByLabel('Suche').fill('berger');
    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
  });

  test('gives a role, shows the address block and blocks deletion while a hold runs', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Nachname').fill('Klein');
    await dialog.getByLabel('Straße').fill('Musterweg 2');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('row', { name: /Klein/ }).click();

    // Der Anschriftsblock steht mehrzeilig da, so wie er ins Fensterkuvert fällt.
    await expect(page.getByTestId('postal-address')).toContainText('Musterweg 2');
    await expect(page.getByTestId('postal-address')).toContainText('12345 Musterstadt');

    await page.getByRole('button', { name: 'Rolle hinzufügen' }).click();
    await page.getByRole('dialog').getByLabel('Rolle').selectOption('interested');
    await page.getByRole('dialog').getByLabel('Seit').fill('2026-03-15');
    await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'interested' })).toBeVisible();

    // Solange die Rolle läuft, hält sie den Kontakt — der Löschknopf ist aus und sagt warum.
    await expect(page.getByRole('button', { name: 'Kontakt löschen' })).toBeDisabled();
    await expect(page.getByTestId('retention-holds')).toContainText('interested');
    await expect(page.getByTestId('retention-holds')).toContainText('2028-12-31');
  });
});
