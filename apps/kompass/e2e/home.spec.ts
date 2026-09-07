import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('home page greets by first name and shows three progress cards', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Guten Tag, Anna.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Einstellungen vervollständigen' })).toBeVisible();
  await expect(page.getByText('1 von 10')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rollen anlegen' })).toBeVisible();
  await expect(page.getByText('3 von 3').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Module aktivieren' })).toBeVisible();
  await page.getByRole('link', { name: 'Zu den Einstellungen' }).click();
  await expect(page).toHaveURL('/admin/settings');
});
