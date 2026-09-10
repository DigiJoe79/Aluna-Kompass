import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('command palette and error pages', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('opens with Ctrl+K, filters and navigates', async ({ page }) => {
    // Der Tastaturhorcher hängt an einem Effekt; vor der Hydration geht der
    // Tastendruck ins Leere.
    await expect(page.locator('body[data-command-palette="ready"]')).toBeAttached();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Rollen');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/roles');
  });

  test('renders 404 inside the shell and the real documents page', async ({ page }) => {
    await page.goto('/admin/gibt-es-nicht');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await page.goto('/admin/documents');
    await expect(page.getByRole('button', { name: 'Basis-Vorlagen' })).toBeVisible();
  });
});
