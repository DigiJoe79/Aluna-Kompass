import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Die Akte — Entwurf, Vorschau, Festschreiben, Liste, Storno — zog ins Modul
 * `dms` (Plan „dms-1-umzug"). Ihre Oberfläche unter `/dms` entsteht erst mit
 * Plan „dms-4-oberflaeche-mcp-seed"; bis dahin bleibt hier nur die Pipeline.
 */
test.describe('documents', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows the base templates, ready to render', async ({ page }) => {
    await page.goto('/admin/documents');
    await page.getByRole('button', { name: 'Basis-Vorlagen' }).click();
    await expect(page.getByText('a4-mit-briefkopf', { exact: true })).toBeVisible();
    await expect(page.getByText('bereit').first()).toBeVisible();
  });

  test('exports the audit log as an ad-hoc download that files no document', async ({ page }) => {
    await page.goto('/admin/audit?channel=system');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Als PDF exportieren' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Änderungsprotokoll.pdf');
  });
});
