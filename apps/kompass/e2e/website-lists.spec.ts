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
});
