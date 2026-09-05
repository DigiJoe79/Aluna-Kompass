import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('command palette and error pages', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('opens with Ctrl+K, filters and navigates', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Rollen');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/roles');
  });

  test('renders 404 inside the shell and the documents placeholder', async ({ page }) => {
    await page.goto('/admin/gibt-es-nicht');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await page.goto('/admin/documents');
    await expect(page.getByText('Folgt mit der Dokumenten-Engine')).toBeVisible();
  });
});
