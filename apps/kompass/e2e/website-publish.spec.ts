import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('publish page runs the checks and blocks on a blocked term', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/website/facts');
  await page.getByRole('button', { name: 'Sperrwort hinzufügen' }).click();
  await page.getByLabel('Sperrwort 1').fill('Popescu');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('gespeichert');
  await page.goto('/website/pages/partners');
  await page.locator('[name="body.de"]').fill('Frau Popescu betreibt den Shelter.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const violations = page.getByRole('region', { name: 'Sperrworttreffer' });
  await expect(violations).toContainText('pages');
  await expect(violations).toContainText('Popescu');
  await expect(page.getByRole('button', { name: /publizieren/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Übersetzungslücken' })).toContainText('partners');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Webseite' })).toBeVisible();
});
