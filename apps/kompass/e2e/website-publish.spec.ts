import path from 'node:path';
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

test('preview build, diff and publish to the local staging target', async ({ page, request }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/animals/new');
  await page.getByLabel('Slug (URL-Teil)').fill('luna');
  await page.getByLabel('Name').fill('Luna');
  await page.getByLabel('Geschlecht').selectOption('female');
  await page.getByRole('button', { name: 'Speichern' }).click();
  const publish = page.getByRole('switch', { name: 'Veröffentlicht' });
  await publish.click();
  // Siehe animals.spec.ts: ohne dieses Warten baut die Vorschau womoeglich
  // einen Stand ohne den Hund.
  await expect(publish).toBeChecked();

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(page.getByRole('region', { name: 'Änderungen gegenüber Live' })).toContainText('zuhause-gesucht/luna/index.html', { timeout: 180_000 });
  const preview = await page.request.get('/website/preview/zuhause-gesucht/luna/');
  expect(preview.ok()).toBe(true);
  expect(await preview.text()).toContain('Luna');
  await page.getByRole('link', { name: 'Vorschau öffnen' }).click();
  await expect(page.getByTestId('env-banner')).toBeVisible();

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Nach Staging publizieren' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Jetzt publizieren' }).click();
  await expect(page.getByRole('status')).toContainText('Publiziert', { timeout: 180_000 });
  await expect(page.getByRole('table', { name: 'Publish-Historie' }).getByRole('row').nth(1)).toContainText('success');
  const fs = await import('node:fs');
  expect(fs.existsSync(path.join(process.env.E2E_SITE_TARGET!, 'zuhause-gesucht', 'luna', 'index.html'))).toBe(true);
});
