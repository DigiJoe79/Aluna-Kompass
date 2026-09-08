import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Die Projekte liegen im Kern, nicht im abgelösten Webseiten-Modul. Dieser
 * Ablauf lag bis zum Cutover in `website-lists.spec.ts` unter `/website/projects`.
 */
test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('create with betterplace id, then publish from the list', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('grundversorgung');
    await page.locator('[name="name.de"]').fill('Grundversorgung');
    await page.getByLabel('Typ').selectOption('ongoing');
    await page.getByLabel('Betterplace-Projekt-ID').fill('123456');
    await page.locator('[name="summary.de"]').fill('Futter, Wärme und tierärztliche Versorgung.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.getByText('Finanzen folgen in einer späteren Stufe')).toBeVisible();

    await page.goto('/projects');
    const row = page.getByRole('row', { name: /Grundversorgung/ });
    await expect(row).toContainText('Dauerprojekt');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');
  });
});
