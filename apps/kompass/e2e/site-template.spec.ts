import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('reads a template, fills a variable and keeps a collection entry', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await expect(page.getByRole('region', { name: 'Befunde' })).toBeVisible();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Wir bauen Modelle');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.getByRole('link', { name: 'Aktuelles' }).click();
  await expect(page).toHaveURL('/site/c/news');
  await page.getByRole('link', { name: 'Neu' }).click();
  await page.getByLabel('Slug (URL-Teil)').fill('erste-notiz');
  await page.locator('[name="title.de"]').fill('Erste Notiz');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL('/site/c/news');
  await expect(page.getByRole('table')).toContainText('Erste Notiz');
});

test('shows no starting-content card when the template has no seed/', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
  await page.reload();
  await expect(page.getByText('Das Template bringt Startinhalte mit')).toHaveCount(0);
  await expect(page.getByText('Startinhalte übernommen am')).toHaveCount(0);
});

test('a reference variable is a choice, and a withdrawn record shows as stale until cleared', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  const choice = page.getByLabel('Projekt auf der Startseite');
  await expect(choice.locator('option')).toContainText(['Keine Auswahl', 'Winterhilfe für Streuner']);
  await choice.selectOption('winterhilfe');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Projekt auf der Startseite')).toHaveValue('winterhilfe');

  await page.goto('/projects');
  const row = page.getByRole('row', { name: /Winterhilfe/ });
  await row.getByRole('switch').click();
  await expect(row).not.toContainText('Veröffentlicht');

  await page.goto('/site/variables');
  await expect(page.getByText('„winterhilfe“ steht nicht mehr zur Auswahl.')).toBeVisible();

  // Ein veralteter Wert, den niemand anfasst, blockiert die übrigen Felder nicht (Spec § 4.3).
  await page.locator('[name="claim.de"]').fill('Trotz veraltetem Verweis gespeichert');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.locator('[name="claim.de"]')).toHaveValue('Trotz veraltetem Verweis gespeichert');
  await expect(page.getByText('„winterhilfe“ steht nicht mehr zur Auswahl.')).toBeVisible();

  await page.getByRole('button', { name: 'Leeren' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Projekt auf der Startseite')).toHaveValue('');
  await expect(page.getByText('steht nicht mehr zur Auswahl')).toHaveCount(0);
});
