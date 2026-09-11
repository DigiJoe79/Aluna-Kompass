import { expect, test, type Locator } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Geprüft wird die Geometrie, weil genau die brach: Eingabefeld, Auswahlfeld
 * und Knopf standen in derselben Zeile mit 32, 34 und 32 px nebeneinander.
 * Ein Test, der nur tippt und klickt, sieht das nicht.
 */
const FIELD_HEIGHT = 38;

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element nicht sichtbar');
  return Math.round(box.height);
}

test.describe('field metrics', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('gibt Eingabefeld, Auswahlfeld und Knopf dieselbe Höhe', async ({ page }) => {
    await page.goto('/dms/receive');
    // Im Dialog gesucht: „Betreff“ heisst auch das Suchfeld der Liste dahinter.
    const dialog = page.getByRole('dialog', { name: 'Post ablegen' });
    await expect(dialog.getByLabel('Betreff')).toBeVisible();

    expect(await height(dialog.getByLabel('Betreff'))).toBe(FIELD_HEIGHT);
    expect(await height(dialog.getByLabel('Dokumentart'))).toBe(FIELD_HEIGHT);
    expect(await height(dialog.getByRole('button', { name: 'Ablegen' }))).toBe(FIELD_HEIGHT);
  });

  test('hält die Höhe auch dort, wo Felder von Hand gebaut waren', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByLabel('Vereinsname')).toBeVisible();

    expect(await height(page.getByLabel('Vereinsname'))).toBe(FIELD_HEIGHT);
    expect(await height(page.getByLabel('Rechtsform'))).toBe(FIELD_HEIGHT);
  });

  test('zeigt Pflichtfelder am Sternchen und die Legende darunter', async ({ page }) => {
    await page.goto('/dms/receive');
    const dialog = page.getByRole('dialog', { name: 'Post ablegen' });
    await expect(dialog.getByLabel('Betreff', { exact: true })).toBeVisible();

    // Sichtbar am Feld, ohne im Namen des Feldes zu landen …
    await expect(dialog.locator('[data-slot="label-required"]').filter({ hasText: 'Betreff' })).toHaveText(
      /^Betreff\s*\*$/
    );
    // … und erklärt in der Fußleiste, solange nichts geändert wurde.
    await expect(dialog.getByText('* Pflichtfeld')).toBeVisible();

    await dialog.getByLabel('Betreff', { exact: true }).fill('Bescheid der Stadtkasse');
    await expect(dialog.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
    await expect(dialog.getByText('* Pflichtfeld')).toHaveCount(0);
  });
});
