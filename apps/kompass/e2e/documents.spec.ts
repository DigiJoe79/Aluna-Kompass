import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Die Akte — Entwurf, Vorschau, Festschreiben, Liste, Storno — zog ins Modul
 * `dms` (Plan „dms-1-umzug“). Ihre Oberfläche unter `/dms` entsteht erst mit
 * Plan „dms-4-oberflaeche-mcp-seed“; bis dahin bleibt hier nur die Pipeline.
 */
test.describe('documents', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows the base templates, ready to render', async ({ page }) => {
    await page.goto('/admin/documents');
    const bases = page.getByRole('region', { name: 'Basis-Vorlagen' });
    await expect(bases.getByText('a4-mit-briefkopf', { exact: true })).toBeVisible();
    await expect(bases.getByText('bereit').first()).toBeVisible();
    await expect(bases.getByText('mitgeliefert').first()).toBeVisible();
  });

  /**
   * Befund Joe, 2026-09-30: „Vorgabe der Vorlage“ sagte nicht, welche Basis das ist, und eine Übersteuerung war
   * nicht als solche zu erkennen – eine alte stand unbemerkt auf dem Protokoll-Auszug.
   */
  test('sagt je Dokumentart, worauf sie erscheint, und macht eine Abweichung sichtbar', async ({ page }) => {
    await page.goto('/admin/documents');
    const types = page.getByRole('region', { name: 'Dokumentarten' });
    const row = types.getByRole('row', { name: /Änderungsprotokoll-Export/ });
    await expect(row.getByTestId('effective-base')).toContainText('a4-plain-slim');
    await expect(row.getByRole('combobox').locator('option').first()).toHaveText('Vorgabe der Vorlage (a4-plain-slim)');
    await expect(row.getByText('abweichend')).toHaveCount(0);

    await row.getByRole('combobox').selectOption('a4-plain');
    await expect(row.getByText('abweichend')).toBeVisible();
    await expect(row.getByTestId('effective-base')).toContainText('a4-plain');
    await expect(row.getByTestId('effective-base')).not.toContainText('a4-plain-slim');

    await row.getByRole('button', { name: 'Zurücksetzen' }).click();
    await expect(row.getByText('abweichend')).toHaveCount(0);
    await expect(row.getByTestId('effective-base')).toContainText('a4-plain-slim');
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
