import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

test('publish page runs the checks and blocks on a blocked term', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await setE2ESetting(page, 'site.blockedTerms', ['Popescu']);

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Frau Popescu betreibt den Verein.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const violations = page.getByRole('region', { name: 'Sperrworttreffer' });
  await expect(violations).toContainText('variables.claim');
  await expect(violations).toContainText('Popescu');
  await expect(page.getByRole('button', { name: /publizieren/i })).toHaveCount(0);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Webseite' })).toBeVisible();
});

test('preview build, diff and publish to the local staging target', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/c/news/new');
  await page.getByLabel('Slug (URL-Teil)').fill('sommerfest');
  await page.locator('[name="title.de"]').fill('Sommerfest 2026');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL('/site/c/news');
  const publish = page.getByRole('switch', { name: 'Veröffentlicht' });
  await publish.click();
  await expect(publish).toBeChecked();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(page.getByRole('region', { name: 'Änderungen gegenüber Live' })).toContainText('aktuelles/sommerfest/index.html', { timeout: 180_000 });
  const preview = await page.request.get('/site/preview/aktuelles/sommerfest/');
  expect(preview.ok()).toBe(true);
  expect(await preview.text()).toContain('Sommerfest 2026');
  await page.getByRole('link', { name: 'Vorschau öffnen' }).click();
  await expect(page.getByTestId('env-banner')).toBeVisible();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Nach Staging publizieren' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Jetzt publizieren' }).click();
  await expect(page.getByRole('status')).toContainText('Publiziert', { timeout: 180_000 });
  await expect(page.getByRole('table', { name: 'Publish-Historie' }).getByRole('row').nth(1)).toContainText('success');
  const fs = await import('node:fs');
  expect(fs.existsSync(path.join(process.env.E2E_SITE_TARGET!, 'aktuelles', 'sommerfest', 'index.html'))).toBe(true);
});

test('the connection test lists what a publish would remove and touches nothing', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  // Die Publizieren-Seite gibt es erst mit eingelesenem Template.
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
  const fs = await import('node:fs');
  const target = process.env.E2E_SITE_TARGET!;
  fs.mkdirSync(target, { recursive: true });
  const stranger = path.join(target, 'fremde-datei.html');
  fs.writeFileSync(stranger, '<html>WordPress</html>');

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Verbindung testen' }).click();
  const result = page.getByRole('region', { name: 'Verbindungstest' });
  await expect(result).toContainText('fremde-datei.html', { timeout: 60_000 });

  expect(fs.readFileSync(stranger, 'utf8')).toBe('<html>WordPress</html>');
});
