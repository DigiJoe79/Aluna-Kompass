import { expect, test } from './fixtures';
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
  // 5 Kernseed-Personen + Nadja Vogt (F8a Task 7, Rolle „Auslagen einreichen“).
  await expect(confirm).toContainText('6 Nutzer');
  await expect(confirm.getByRole('button', { name: 'Bestand überschreiben' })).toBeDisabled();
  await confirm.getByLabel('Tippen Sie zur Bestätigung den Umgebungsnamen').fill('test');
  await confirm.getByRole('button', { name: 'Bestand überschreiben' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);
  // Der Toast sagt das Ergebnis an, der Kasten im Formular trägt die Details (MUSTER § A).
  await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Import abgeschlossen')).toBeVisible();
  await expect(page.locator('form').getByText('Import abgeschlossen')).toBeVisible();
  // Die Weiterleitung ist kein Netzfehler; „Erneut versuchen“ hätte den Import wiederholt (Befund 19 in 0.2.9).
  await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Die Verbindung zum Server ist abgebrochen')).toHaveCount(0);

  await loginAsAdmin(page);
  await page.goto('/admin/audit');
  // Neueste zuerst: über dem Import steht der erneute Login nach dem Import. Die Aktion steht als Satz (Spec Protokoll § 4).
  await expect(page.getByRole('table')).toContainText(/Sicherung vom \d/);
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
});

test('die Frist für das Backup lässt sich einstellen und wirkt auf der Startseite', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  const field = page.getByLabel('Warnen, wenn das letzte Backup älter ist als');
  await expect(field).toHaveValue('30');
  await field.fill('14');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Frist gespeichert')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Warnen, wenn das letzte Backup älter ist als')).toHaveValue('14');
});
