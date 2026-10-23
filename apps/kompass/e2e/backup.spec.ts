import { expect, test } from './fixtures';
import { createAndDownloadBackup, loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

test('erstellt ein Backup, lädt es herunter und wieder hoch und spielt es über die Wartungsseite ein', async ({ page, request }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  const archivePath = await createAndDownloadBackup(page);
  await page.getByRole('button', { name: 'Datei hochladen …' }).click();
  const upload = page.getByRole('dialog', { name: 'Backup-Datei hochladen' });
  await upload.getByLabel('Backup-Datei').setInputFiles(archivePath);
  await expect(upload.getByText(/Hochgeladen und geprüft/)).toBeVisible({ timeout: 30_000 });
  await upload.getByRole('button', { name: 'Einspielen …' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('button', { name: 'Einspielen' })).toBeDisabled();
  await confirm.getByLabel('Zur Bestätigung den Namen der Umgebung eintippen').fill('test');
  await confirm.getByRole('button', { name: 'Einspielen' }).click();
  await expect(page).toHaveURL(/\/maintenance$/);
  // Die Seite lädt sich selbst nach, bis der Lauf fertig ist.
  await expect(page.getByRole('heading', { name: /ist eingespielt/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  await expect(page.getByRole('row', { name: /vor Einspielen/ })).toBeVisible();
  expect((await request.get('/api/health')).ok()).toBe(true);
});

test('Zeitplan und Frist lassen sich speichern', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup?panel=settings');
  await waitForHydration(page, '#backup-schedule-time');
  await page.getByRole('switch', { name: 'Jede Nacht ein Backup erstellen' }).click();
  await page.getByLabel('Uhrzeit').fill('04:00');
  await page.getByLabel('Warnen, wenn das letzte geprüfte Backup älter ist als').fill('14');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Einstellungen gespeichert')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Uhrzeit')).toHaveValue('04:00');
  await expect(page.getByLabel('Warnen, wenn das letzte geprüfte Backup älter ist als')).toHaveValue('14');
  await expect(page.getByRole('switch', { name: 'Jede Nacht ein Backup erstellen' })).toBeChecked();
});
