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
    await expect(page.getByLabel('Betreff')).toBeVisible();

    expect(await height(page.getByLabel('Betreff'))).toBe(FIELD_HEIGHT);
    expect(await height(page.getByLabel('Dokumentart'))).toBe(FIELD_HEIGHT);
    expect(await height(page.getByRole('button', { name: 'Ablegen' }))).toBe(FIELD_HEIGHT);
  });

  test('hält die Höhe auch dort, wo Felder von Hand gebaut waren', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByLabel('Vereinsname')).toBeVisible();

    expect(await height(page.getByLabel('Vereinsname'))).toBe(FIELD_HEIGHT);
    expect(await height(page.getByLabel('Rechtsform'))).toBe(FIELD_HEIGHT);
  });
});
