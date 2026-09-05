import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('website lists', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('articles: create, edit with markdown preview, publish, reorder', async ({ page }) => {
    await page.goto('/website/articles');
    await expect(page.getByText('Noch keine Artikel')).toBeVisible();
    await page.getByRole('link', { name: 'Artikel anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('ablauf-der-adoption');
    await page.locator('[name="title.de"]').fill('Ablauf der Adoption');
    await page.locator('[name="body.de"]').fill(':::karten\n### Schritt 1\nMelde dich bei uns.\n:::');
    await expect(page.locator('.prose-preview .card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/website\/articles\/[A-Z0-9]+$/);
    await page.goto('/website/articles');
    await page.getByRole('link', { name: 'Artikel anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('transport');
    await page.locator('[name="title.de"]').fill('Ablauf des Transportes');
    await page.locator('[name="title.en"]').fill('Transport');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.goto('/website/articles');
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText('Ablauf der Adoption');
    await rows.nth(1).getByRole('switch').click();
    await expect(rows.nth(1)).toContainText('Veröffentlicht');
    await rows.nth(2).getByRole('button', { name: 'Nach oben' }).click();
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Ablauf des Transportes');
  });

  test('team: create with photo, publish; faq: create in category', async ({ page }) => {
    await page.goto('/website/team');
    await page.getByRole('button', { name: 'Teammitglied anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Nicole Wießner');
    await dialog.locator('[name="position.de"]').fill('Erste Vorsitzende & Fundraising');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await dialog.getByLabel(/Foto Datei wählen/).setInputFiles({ name: 'nicole.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.locator('img[src^="/media/"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    const row = page.getByRole('row', { name: /Nicole Wießner/ });
    await expect(row).toContainText('Nicht veröffentlicht');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');

    await page.goto('/website/faqs');
    await page.getByRole('button', { name: 'Frage anlegen' }).click();
    const faq = page.getByRole('dialog');
    await faq.locator('[name="category.de"]').fill('Spenden');
    await faq.locator('[name="question.de"]').fill('Wohin geht meine Spende?');
    await faq.locator('[name="answer.de"]').fill('An den Shelter.');
    await faq.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('row', { name: /Wohin geht meine Spende/ })).toContainText('Spenden');
  });
});
