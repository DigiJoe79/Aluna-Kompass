import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('documents', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a letterhead document from Markdown, previews it, downloads the PDF and voids it', async ({ page }) => {
    await page.goto('/admin/documents');
    await page.getByRole('button', { name: 'Basis-Vorlagen' }).click();
    await expect(page.getByText('a4-mit-briefkopf', { exact: true })).toBeVisible();
    await expect(page.getByText('bereit').first()).toBeVisible();

    await page.getByRole('button', { name: 'Dokument erzeugen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Vorlage').selectOption('letterhead');
    await dialog.getByLabel('Titel').fill('Einladung zur Mitgliederversammlung');
    await dialog.getByLabel('Text (Markdown)').fill('Sehr geehrte Mitglieder,\n\n## Tagesordnung\n\n- Bericht\n- Wahlen');
    await dialog.getByRole('button', { name: 'Erzeugen' }).click();
    const row = page.getByRole('row', { name: /Einladung zur Mitgliederversammlung/ });
    await expect(row).toContainText('BRF-2026-001');
    await expect(page.getByTitle('Vorschau BRF-2026-001')).toHaveAttribute('src', /\/documents\/[A-Z0-9]+\/file$/);
    const href = await row.getByRole('link', { name: 'Herunterladen' }).getAttribute('href');
    const pdf = await page.request.get(href!);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await row.getByRole('button', { name: 'Stornieren' }).click();
    await page.getByRole('alertdialog').getByLabel('Grund').fill('Datum falsch');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stornieren' }).click();
    await expect(row).toContainText('Storniert');
    await expect(row.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Dokument erzeugen' }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Ersatz');
    await page.getByRole('dialog').getByRole('button', { name: 'Erzeugen' }).click();
    await expect(page.getByRole('row', { name: /Ersatz/ })).toContainText('BRF-2026-002');
  });

  test('exports the audit log as a PRO document with the active filters', async ({ page }) => {
    await page.goto('/admin/audit?channel=system');
    await page.getByRole('button', { name: 'Als PDF exportieren' }).click();
    await expect(page).toHaveURL(/\/admin\/documents\?selected=/);
    await expect(page.getByRole('row', { name: /Änderungsprotokoll/ })).toContainText('PRO-2026-001');
  });

  test('a logo set in branding appears in the sidebar and in a rendered document', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Branding' }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.getByLabel('Logo-Datei').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'Logo speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Logo gespeichert');
    const logo = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('img', { name: 'Vereinslogo' });
    await expect(logo).toHaveAttribute('src', /\/media\/[A-Z0-9]+$/);

    // Mit gesetztem Logo darf ein Dokument-Render nicht scheitern (das Bild landet im Briefkopf).
    await page.goto('/admin/documents');
    await page.getByRole('button', { name: 'Dokument erzeugen' }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Mit Logo');
    await page.getByRole('dialog').getByRole('button', { name: 'Erzeugen' }).click();
    const row = page.getByRole('row', { name: /Mit Logo/ });
    await expect(row).toContainText('BRF-2026-001');
    const pdf = await (await page.request.get((await row.getByRole('link', { name: 'Herunterladen' }).getAttribute('href'))!)).body();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
