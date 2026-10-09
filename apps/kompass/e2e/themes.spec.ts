import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('themes', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/themes');
  });

  test('default is read-only and active; duplicating creates an editable copy', async ({ page }) => {
    await expect(page.getByRole('listitem', { name: /Default/ })).toContainText('Aktiv');
    // Default und aktives Theme haben keinen sichtbaren Eintrag — also auch kein ⋯; der Grund steht in der Seitenleiste.
    await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toHaveCount(0);
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
    // Warnung ohne Sperre (`status`), Speichern bleibt möglich (K10 Charge 2).
    const contrast = page.locator('main').getByRole('status').filter({ hasText: 'Kontrast unter AA' });
    await expect(contrast).toBeVisible();
    await page.getByLabel('muted hell', { exact: true }).fill('#666D75');
    await expect(contrast).toHaveCount(0);
    await page.getByLabel('color-primary hell').fill('#8A2C2C');
    await expect(page.getByTestId('preview-primary-button')).toHaveCSS('background-color', 'rgb(138, 44, 44)');
    await page.getByRole('button', { name: 'Theme speichern' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Theme gespeichert' })).toContainText('Theme gespeichert');
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
    await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Default/ }).click();
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await page.getByRole('button', { name: /^Kopie/ }).click();
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Theme löschen …' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page.getByRole('listitem', { name: /Kopie/ })).toHaveCount(0);
  });
});
