import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
  });

  /**
   * Die Reiterleiste gehört über die Inhaltsfläche, nicht daneben. Geprüft wird
   * hier die Geometrie, weil genau die brach: Zwölf Klassen zielten auf ein
   * `data-horizontal`, das im DOM nie stand, und die Wurzel blieb in
   * Zeilenrichtung. Ein Test, der nur klickt, sieht das nicht.
   */
  test('legt die Reiterleiste über die Inhaltsfläche, nicht daneben', async ({ page }) => {
    const list = page.getByRole('tablist').first();
    const panel = page.getByRole('tabpanel').first();
    const listBox = await list.boundingBox();
    const panelBox = await panel.boundingBox();
    if (!listBox || !panelBox) throw new Error('Reiter nicht sichtbar');

    expect(listBox.y + listBox.height).toBeLessThanOrEqual(panelBox.y + 1);
    // Und sie ist eine Leiste, kein hoher Kasten: deutlich breiter als hoch.
    expect(listBox.width).toBeGreaterThan(listBox.height);
  });

  test('saves changed fields, shows the pending counter and audits', async ({ page }) => {
    await page.getByLabel('Vereinsname').fill('Aluna Musterverein e.V.');
    await page.getByLabel('Ort').fill('Jülich');
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Einstellungen gespeichert');
    await page.reload();
    await expect(page.getByLabel('Vereinsname')).toHaveValue('Aluna Musterverein e.V.');
    await page.goto('/admin/audit');
    await expect(page.getByRole('row', { name: /organization.name/ }).first()).toBeVisible();
  });

  test('marks the tab with a validation error and keeps the input', async ({ page }) => {
    await page.getByRole('tab', { name: 'Verein' }).click();
    await page.getByLabel('Kontakt-E-Mail').fill('keine-mail');
    await page.getByRole('tab', { name: 'Bank' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('tab', { name: /Verein/ })).toHaveAttribute('data-invalid', 'true');
    await page.getByRole('tab', { name: /Verein/ }).click();
    await expect(page.getByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
    await expect(page.getByLabel('Kontakt-E-Mail')).toHaveValue('keine-mail');
  });

  test('tax tab shows the incomplete alert and the purpose counter', async ({ page }) => {
    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Zuwendungsbestätigungen');
    await page.getByLabel('Satzungszweck').fill('Förderung des Tierschutzes');
    await expect(page.getByText('26 von 500 Zeichen')).toBeVisible();
  });
});
