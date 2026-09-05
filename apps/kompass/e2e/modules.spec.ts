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
  await expect(page.getByText('3 von 3 aktiv')).toBeVisible();
});
