import { expect, test } from '@playwright/test';
import { ADMIN, loginAsAdmin, resetDatabase } from './helpers';

test.describe('profile', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/profile');
  });

  test('creates an API token shown once, lists it and revokes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Token erstellen' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Buchhaltung Skript');
    await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
    const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
    expect(token).toMatch(/^akx_test_/);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Schließen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
    const row = page.getByRole('row', { name: /Buchhaltung Skript/ });
    await expect(row).toContainText(token.slice(0, 12));
    await row.getByRole('button', { name: 'Widerrufen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Widerrufen' }).click();
    await expect(page.getByRole('row', { name: /Buchhaltung Skript/ })).toContainText('widerrufen');
  });

  test('changes the own password and ends other sessions', async ({ browser, page }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginAsAdmin(otherPage);
    await page.getByLabel('Aktuelles Passwort').fill(ADMIN.password);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('ganz-neues-admin-passwort');
    await page.getByLabel('Passwort wiederholen').fill('ganz-neues-admin-passwort');
    await page.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(page.getByRole('status')).toContainText('Passwort geändert');
    await otherPage.reload();
    await expect(otherPage).toHaveURL('/login');
    await other.close();
  });
});
