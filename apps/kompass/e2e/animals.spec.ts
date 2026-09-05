import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('animals', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a dog, adds photos, publishes, adopts with a story', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('chiara');
    await page.getByLabel('Name').fill('Chiara');
    await page.getByLabel('Geschlecht').selectOption('female');
    await page.getByLabel('Größe in cm (für den Filter)').fill('45');
    await page.getByLabel('Notfall').check();
    await page.getByLabel('Patentier').check();
    await page.getByRole('tab', { name: 'Texte' }).click();
    await page.locator('[name="summary.de"]').fill('Sanfte, freundliche Hündin.');
    await page.locator('[name="traits__text.de"]').fill('ruhig, verträglich');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);

    await page.getByRole('tab', { name: 'Fotos' }).click();
    await page.getByLabel(/Foto hochladen/).setInputFiles({ name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Fotos speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Fotos gespeichert');

    await page.getByRole('switch', { name: 'Veröffentlicht' }).click();
    await page.goto('/animals');
    const row = page.getByRole('row', { name: /Chiara/ });
    await expect(row).toContainText('Sucht ein Zuhause');
    await expect(row).toContainText('Notfall');
    await expect(row).toContainText('Veröffentlicht');

    await row.getByRole('link', { name: 'Chiara' }).click();
    await page.getByRole('button', { name: 'Status ändern' }).click();
    await page.getByRole('dialog').getByLabel('Neuer Status').selectOption('adopted');
    await page.getByRole('dialog').getByLabel('Vermittlungsjahr').fill('2026');
    await page.getByRole('dialog').getByRole('button', { name: 'Status setzen' }).click();
    await expect(page.getByRole('status')).toContainText('Status gesetzt');
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await page.locator('[name="quote.de"]').fill('Endlich zuhause.');
    await page.getByLabel('Familie').fill('Familie M.');
    await page.getByRole('button', { name: 'Geschichte speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Geschichte gespeichert');
  });

  test('the story tab is locked until the dog is adopted', async ({ page }) => {
    await page.goto('/animals/new');
    await page.getByLabel('Slug (URL-Teil)').fill('bruno');
    await page.getByLabel('Name').fill('Bruno');
    await page.getByLabel('Geschlecht').selectOption('male');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.getByText('Erst nach der Vermittlung')).toBeVisible();
  });
});
