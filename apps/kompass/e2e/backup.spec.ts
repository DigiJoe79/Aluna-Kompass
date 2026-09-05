import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('exports a backup and imports it back, ending all sessions', async ({ page, request }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export erstellen' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kompass-backup-test-\d{8}-\d{6}\.tar\.gz$/);
  const archivePath = await download.path();
  await expect(page.getByText(/Letzter Export/)).toBeVisible();

  await page.getByLabel('Backup-Datei').setInputFiles(archivePath!);
  await page.getByRole('button', { name: 'Import vorbereiten' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Bestand der Umgebung „test“ überschreiben?');
  await expect(confirm).toContainText('4 Nutzer');
  await expect(confirm.getByRole('button', { name: 'Bestand überschreiben' })).toBeDisabled();
  await confirm.getByLabel('Tippen Sie zur Bestätigung den Umgebungsnamen').fill('test');
  await confirm.getByRole('button', { name: 'Bestand überschreiben' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);
  await expect(page.getByText('Import abgeschlossen')).toBeVisible();

  await loginAsAdmin(page);
  await page.goto('/admin/audit');
  // Neueste zuerst: über dem backup.import steht der erneute Login (auth.login) nach dem Import.
  await expect(page.getByRole('table')).toContainText('backup.import');
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
});
