import { expect, test } from '@playwright/test';
import { ADMIN, loginAsAdmin, resetDatabase } from './helpers';

test.describe('first run and login', () => {
  test('empty database redirects to setup, creates the admin and lands on the home page', async ({ page }) => {
    await resetDatabase(page, 'empty');
    await page.goto('/login');
    await expect(page).toHaveURL('/setup');
    await expect(page.getByRole('heading', { name: 'Erste Einrichtung' })).toBeVisible();
    await page.getByLabel('Vereinsname').fill('Musterverein e.V.');
    await page.getByLabel('Ihr Name').fill('Anna Berger');
    await page.getByLabel('E-Mail').fill('anna@example.org');
    await page.getByLabel('Passwort').fill('kurz');
    await page.getByRole('button', { name: 'Konto anlegen und starten' }).click();
    await expect(page.getByText('Mindestens 12 Zeichen.')).toBeVisible();
    await page.getByLabel('Passwort').fill('ein-langes-merkbares-passwort');
    await page.getByRole('button', { name: 'Konto anlegen und starten' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Guten Tag, Anna.')).toBeVisible();
    await page.request.post('/logout');
    await page.goto('/setup');
    await expect(page).toHaveURL('/login');
  });

  test('login rejects wrong credentials with remaining attempts and locks after five', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await page.goto('/login');
    const alert = page.locator('form [role="alert"]');
    for (let i = 4; i >= 1; i -= 1) {
      await page.getByLabel('E-Mail').fill(ADMIN.email);
      await page.getByLabel('Passwort').fill('falsch-falsch-00-falsch');
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await expect(alert).toContainText('E-Mail oder Passwort stimmt nicht.');
      await expect(alert).toContainText(`Noch ${i} Versuch`);
    }
    await page.getByLabel('Passwort').fill('falsch-falsch-00-falsch');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(alert).toContainText('für 15 Minuten gesperrt');
  });

  test('a user with a start password must set a new one before seeing the shell', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Rita Sommer');
    await dialog.getByLabel('E-Mail').fill('rita@example.org');
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');

    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('rita@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL('/password');
    await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL('/password');
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('rita-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('rita-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
  });
});
