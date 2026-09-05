import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('website pages', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('lists the twelve fixed pages with gap counters and edits one with preview and blocks', async ({ page }) => {
    await page.goto('/website/pages');
    await expect(page.getByRole('row')).toHaveCount(13);
    await expect(page.getByRole('row', { name: /Helfen/ })).toBeVisible();
    await page.getByRole('link', { name: 'Helfen' }).click();
    await expect(page).toHaveURL('/website/pages/help');
    await page.getByLabel('DE', { exact: true }).first().fill('Es gibt viele Wege, ein Leben zu *verändern.*');
    await page.locator('[name="body.de"]').fill('## Unsere *Spendenboxen.*\n\n> Wir freuen uns über jeden Cent.\n\n:::karten\n### Köln-Porz\nBäckerei am Markt.\n:::');
    await expect(page.locator('.prose-preview .note')).toContainText('Wir freuen uns über jeden Cent.');
    await expect(page.locator('.prose-preview .card h3')).toHaveText('Köln-Porz');
    await page.getByRole('button', { name: 'Baustein hinzufügen' }).click();
    await page.getByLabel('Baustein-ID').fill('donate');
    await page.locator('[name="block-title.de"]').fill('Spenden');
    await page.locator('[name="block-href"]').fill('/spenden/');
    await page.getByRole('button', { name: 'Baustein übernehmen' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Gespeichert');
    await page.reload();
    await expect(page.locator('[name="title.de"]')).toHaveValue('Es gibt viele Wege, ein Leben zu *verändern.*');
    await expect(page.getByText('Spenden', { exact: true })).toBeVisible();
    await expect(page.getByText(/Übersetzung(en)? offen/)).toBeVisible();
  });

  test('is forbidden without website.view', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const pw = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(pw);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(pw);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/website/pages');
    await expect(page.getByText('website.view')).toBeVisible();
  });
});
