import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const TEMPLATE_DIR = process.env.E2E_SITE_TEMPLATE_DIR!;

const TEMPLATE = `
import { defineTemplate, markdown, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'E2E Basis',
  locales: ['de'],
  variables: {
    claim: text({ localized: true, label: 'Claim' }),
  },
  collections: {
    notes: { label: 'Notizen', fields: { body: markdown({ label: 'Text' }) } },
  },
});
`;

test('reads a template, fills a variable and keeps a collection entry', async ({ page }) => {
  rmSync(TEMPLATE_DIR, { recursive: true, force: true });
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  writeFileSync(path.join(TEMPLATE_DIR, 'kompass.template.ts'), TEMPLATE);

  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await expect(page.getByRole('region', { name: 'Befunde' })).toContainText('wird leer angelegt');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Wir bauen Modelle');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.getByRole('link', { name: 'Notizen' }).click();
  await expect(page).toHaveURL('/site/c/notes');
  await page.getByRole('link', { name: 'Neu' }).click();
  await page.locator('[name="body"]').fill('Erste Notiz');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('table')).toContainText('Erste Notiz');
});
