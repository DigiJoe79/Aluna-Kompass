import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('audit log', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('lists entries newest first, filters by channel and opens the field diff', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Vereinsname').fill('Geänderter Verein e.V.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');
    await page.goto('/admin/audit');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.nth(1)).toContainText('settings.update');
    await expect(rows.nth(1)).toContainText('Oberfläche');
    await page.getByLabel('Kanal').selectOption('system');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('System');
    await page.getByLabel('Kanal').selectOption('');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('settings.update');
    await rows.nth(1).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText('organization.name');
    await expect(detail.getByText('Musterverein e.V.')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(detail.getByText('Geänderter Verein e.V.')).toBeVisible();
    await expect(detail).toContainText('Einträge können nicht geändert werden.');
  });

  test('requires audit.view', async ({ page }) => {
    // Schriftführung (documents.export) hat kein audit.view
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/admin/audit');
    await expect(page.getByText('audit.view')).toBeVisible();
  });
});
