import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('restores a backup from the setup page and signs in with its credentials', async ({ page }) => {
  // Erst einen Bestand erzeugen und exportieren.
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/backup');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export erstellen' }).click(),
  ]);
  const archivePath = await download.path();

  // Dann eine leere Installation und der Weg ueber die Einrichtungsseite.
  await resetDatabase(page, 'empty');
  await page.goto('/setup');
  await page.getByRole('link', { name: /Bestand wiederherstellen/ }).click();
  await expect(page).toHaveURL(/\/setup\/import$/);

  await page.getByLabel('Backup-Datei').setInputFiles(archivePath!);
  await expect(page.getByText('Inhalt des Archivs')).toBeVisible();
  await expect(page.getByText(/Nach dem Einspielen melden Sie sich/)).toBeVisible();

  await page.getByRole('button', { name: 'Diesen Bestand einspielen' }).click();
  await expect(page).toHaveURL(/\/login\?imported=1/);

  // loginAsAdmin prueft selbst, dass danach die Startseite erreicht ist.
  await loginAsAdmin(page);

  // Der Endpunkt schliesst sich selbst, sobald Nutzer existieren.
  await page.goto('/setup/import');
  await expect(page).not.toHaveURL(/\/setup\/import$/);
});
