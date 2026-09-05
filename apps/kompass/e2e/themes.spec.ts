import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('themes', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/themes');
  });

  test('default is read-only and active; duplicating creates an editable copy', async ({ page }) => {
    await expect(page.getByRole('listitem', { name: /Default/ })).toContainText('Aktiv');
    await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('vereinsfarben');
    await page.getByRole('dialog').getByLabel('Name').fill('Vereinsfarben');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await expect(page.getByRole('listitem', { name: /Vereinsfarben/ })).toBeVisible();
    await expect(page.getByLabel('color-primary hell')).toHaveValue('#2F5D68');
  });

  test('edits a token, warns on low contrast, saves and activates', async ({ page }) => {
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('test');
    await page.getByRole('dialog').getByLabel('Name').fill('Test');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('button', { name: /^Test/ }).click();
    await page.getByLabel('muted hell', { exact: true }).fill('#DDDDDD');
    await expect(page.locator('main').getByRole('alert')).toContainText('Kontrast unter AA');
    await page.getByLabel('muted hell', { exact: true }).fill('#666D75');
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await page.getByLabel('color-primary hell').fill('#8A2C2C');
    await expect(page.getByTestId('preview-primary-button')).toHaveCSS('background-color', 'rgb(138, 44, 44)');
    await page.getByRole('button', { name: 'Theme speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Theme gespeichert');
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await page.goto('/login');
    // Nach Aktivierung liefert das Root-Layout das neue Theme: der Anmelden-Button (nach Logout) hat die neue Primärfarbe.
    await page.request.post('/logout');
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Anmelden' })).toHaveCSS('background-color', 'rgb(138, 44, 44)');
  });

  test('cannot delete the active theme, can delete an inactive one', async ({ page }) => {
    await page.getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('dialog').getByLabel('Schlüssel').fill('kopie');
    await page.getByRole('dialog').getByLabel('Name').fill('Kopie');
    await page.getByRole('dialog').getByRole('button', { name: 'Duplizieren' }).click();
    await page.getByRole('button', { name: /^Kopie/ }).click();
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Default/ }).click();
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await page.getByRole('button', { name: /^Kopie/ }).click();
    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('listitem', { name: /Kopie/ })).toHaveCount(0);
  });
});
