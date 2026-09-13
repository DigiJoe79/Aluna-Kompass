import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');

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
    await expect(page.getByText('laufen Anfragen auf der Webseite über den Partner')).toBeVisible();
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
    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'chiara-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'chiara-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await expect(chooser.getByText('2 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Fotos speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Fotos gespeichert');

    const publish = page.getByRole('switch', { name: 'Veröffentlicht' });
    await publish.click();
    // Der Schalter spiegelt den Serverzustand, nicht den Klick: erst wenn er
    // gesetzt ist, hat die Action geschrieben. Ohne dieses Warten navigiert
    // der Test gelegentlich vor dem Schreibvorgang weiter.
    await expect(publish).toBeChecked();
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
    await page.locator('[name="beforeCaption.de"]').fill('Auf der Pflegestelle');
    await page.locator('[name="afterCaption.de"]').fill('Zuhause in Köln');
    await page.getByRole('button', { name: 'Geschichte speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Geschichte gespeichert');
    await page.reload();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.locator('[name="beforeCaption.de"]')).toHaveValue('Auf der Pflegestelle');
    await expect(page.locator('[name="afterCaption.de"]')).toHaveValue('Zuhause in Köln');
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

  test('unchecking a photo in the chooser removes it from the list', async ({ page }) => {
    await page.goto('/animals');
    await page.getByRole('link', { name: 'Hund anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('bo');
    await page.getByLabel('Name').fill('Bo');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/animals\/[A-Z0-9]+$/);
    await page.getByRole('tab', { name: 'Fotos' }).click();

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    let chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByLabel('Hochladen').setInputFiles([
      { name: 'bo-1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'bo-2.svg', mimeType: 'image/svg+xml', buffer: SVG },
    ]);
    await expect(chooser.getByText('2 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Fotos wählen' }).click();
    chooser = page.getByRole('dialog', { name: 'Bilder wählen' });
    await chooser.getByRole('button', { name: /bo-2-/ }).click();
    await expect(chooser.getByText('1 ausgewählt')).toBeVisible();
    await chooser.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('[data-testid="animal-photo"]')).toHaveCount(1);
  });
});
