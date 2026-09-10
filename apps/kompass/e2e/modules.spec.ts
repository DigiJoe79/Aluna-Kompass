import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('module page shows the locked core and the count', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/modules');
  await expect(page.getByText('Beim Deaktivieren bleiben alle Daten des Moduls erhalten.')).toBeVisible();
  const core = page.getByRole('region', { name: 'Kern' });
  await expect(core).toContainText('Immer aktiv');
  await expect(core.getByRole('switch')).toBeDisabled();
  await expect(core).toContainText('core');
  await expect(page.getByText('4 von 4 aktiv')).toBeVisible();
});

test('a deactivated module disappears from the sidebar', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav.getByRole('link', { name: 'Hunde' })).toBeVisible();

  await page.goto('/admin/modules');
  await page.getByRole('switch', { name: 'Tiere aktivieren oder deaktivieren' }).click();
  await expect(page.getByText('3 von 4 aktiv')).toBeVisible();

  await page.goto('/');
  await expect(nav.getByRole('link', { name: 'Hunde' })).toHaveCount(0);
  await expect(nav.getByText('Tiere', { exact: true })).toHaveCount(0);
});
