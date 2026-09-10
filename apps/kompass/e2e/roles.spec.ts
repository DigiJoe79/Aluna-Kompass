import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('roles', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/roles');
  });

  test('lists roles with counts and shows the protected role locked', async ({ page }) => {
    const list = page.getByRole('list', { name: 'Rollen' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(list.getByRole('listitem', { name: /Administration/ })).toContainText('Alle Rechte');
    await list.getByRole('button', { name: /Administration/ }).click();
    await expect(page.getByLabel('Rollenname')).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Nutzer verwalten' })).toBeDisabled();
  });

  test('edits permissions with a pending counter and saves', async ({ page }) => {
    await page.getByRole('button', { name: /Kassenprüfer/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Änderungsprotokoll einsehen' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Backup exportieren' }).check();
    await page.getByRole('checkbox', { name: 'Auszüge ziehen' }).uncheck();
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');
    await page.reload();
    await page.getByRole('button', { name: /Kassenprüfer/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Backup exportieren' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Auszüge ziehen' })).not.toBeChecked();
    await expect(page.getByText('backup.export')).toBeVisible();
  });

  test('creates a role and rejects a duplicate name', async ({ page }) => {
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Beisitz');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('list', { name: 'Rollen' }).getByRole('listitem', { name: /Beisitz/ })).toBeVisible();
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('beisitz');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('existiert bereits');
  });
});
