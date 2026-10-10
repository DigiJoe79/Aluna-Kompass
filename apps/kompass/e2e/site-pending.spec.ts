import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

const importTemplate = async (page: Page) => {
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');
};
/** Im Test wird nie in die Produktion publiziert; die Route trägt den heutigen Stand als deren letzten Publish ein. */
const markPublished = async (page: Page) => {
  const response = await page.request.post('/__e2e/site-baseline', { headers: { 'x-e2e-token': 'e2e-reset' } });
  expect(response.ok()).toBe(true);
};

test('a public change shows as not published in the header, its menu and on the publish page', async ({ page }) => {
  test.setTimeout(180_000);
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await importTemplate(page);
  await markPublished(page);

  // Ein unveröffentlichter Eintrag ändert die Webseite nicht.
  await page.goto('/site/c/news/new');
  await waitForHydration(page, '[name="title.de"]');
  await page.getByLabel('Slug (URL-Teil)').fill('sommerfest');
  await page.locator('[name="title.de"]').fill('Sommerfest 2026');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page).toHaveURL('/site/c/news');
  await page.reload();
  await expect(page.getByTestId('site-pending-menu')).toHaveCount(0);

  // Veröffentlicht: Die Kopfzeile zählt sofort mit (der Schalter fragt den Poller an).
  await waitForHydration(page, '[role="switch"]');
  const toggle = page.getByRole('row', { name: /Sommerfest 2026/ }).getByRole('switch', { name: 'Veröffentlicht' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  const indicator = page.getByTestId('site-pending-menu');
  await expect(indicator).toHaveText('1 nicht publiziert');
  await indicator.click();
  await expect(page.getByRole('menuitem', { name: 'Sommerfest 2026 (neu)' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Zum Publizieren' }).click();
  await expect(page).toHaveURL('/site/publish');
  await expect(page.getByTestId('site-pending-since')).toContainText('geändert: Sommerfest 2026 (neu).');
  await expect(page.getByTestId('site-pending-since').getByRole('link', { name: 'Sommerfest 2026' })).toHaveAttribute('href', /\/site\/c\/news\//);

  // Telefon: Symbol mit Zahl, ein Tipp führt direkt auf die Seite.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: '1 Änderung nicht publiziert, zum Publizieren' }).click();
  await expect(page).toHaveURL('/site/publish');

  // Die Zeile am Datensatz lautet überall gleich und führt zum Publizieren (Designer 2026-10-10): am Eintrag …
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/site/c/news');
  await page.getByRole('link', { name: 'Sommerfest 2026' }).click();
  await expect(page).toHaveURL(/\/site\/c\/news\/[A-Z0-9]+$/);
  const line = page.getByTestId('site-pending-line');
  await expect(line).toHaveText('Änderung noch nicht publiziert · Zum Publizieren');
  await expect(line.getByRole('link', { name: 'Zum Publizieren' })).toHaveAttribute('href', '/site/publish');

  // … und am Projekt.
  await page.goto('/projects');
  await waitForHydration(page, '[role="switch"]');
  const project = page.getByRole('row', { name: /Kastrationsaktion 2026/ }).getByRole('switch');
  await project.click();
  await expect(project).toBeChecked();
  await page.getByRole('link', { name: 'Kastrationsaktion 2026' }).click();
  await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
  await expect(page.getByTestId('site-pending-line')).toHaveText('Änderung noch nicht publiziert · Zum Publizieren');
  await page.getByTestId('site-pending-line').getByRole('link', { name: 'Zum Publizieren' }).click();
  await expect(page).toHaveURL('/site/publish');

  // Nach dem Publish der Produktion ist die Anzeige weg.
  await markPublished(page);
  await page.reload();
  await expect(page.getByTestId('site-pending')).toHaveCount(0);
});
