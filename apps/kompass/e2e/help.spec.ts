import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('handbook and help', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('the panel shows the lead paragraph of the current page and leads into the handbook', async ({ page }) => {
    // `/dms/receive` wäre der naheliegende Beleg (Manifest: `/dms/receive` →
    // `akte/post-ablegen`), zeigt aber sofort den Dialog „Post ablegen“ über der
    // Liste (`dms-workspace.tsx`): Der Dialog macht den Rest der Seite inert,
    // die Kopfleiste ist für niemanden erreichbar, auch nicht über die Taste
    // `?` — das Fokusziel im Dialog ist ein `input`. `/dms/new` prüft dieselbe
    // Mechanik ohne diesen Konflikt.
    await page.goto('/dms/new');
    await page.getByRole('button', { name: 'Hilfe zu dieser Seite' }).click();
    const panel = page.getByTestId('help-panel');
    await expect(panel.getByRole('heading', { name: 'Brief schreiben' })).toBeVisible();
    await expect(panel).toContainText('Ein Brief entsteht als Entwurf');
    await panel.getByRole('link', { name: 'Ganze Seite lesen' }).click();
    await expect(page).toHaveURL('/help/akte/brief-schreiben');
    await expect(panel).toBeHidden();
    const toc = page.getByRole('navigation', { name: 'Inhaltsverzeichnis' });
    await expect(toc.getByRole('link', { name: 'Brief schreiben' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brief schreiben');
    await expect(page.getByRole('banner')).toContainText('Hilfe');
    await expect(page.getByRole('banner')).toContainText('Akte');
  });

  test('the ? key opens the panel, but not inside a text field', async ({ page }) => {
    await page.goto('/contacts');
    await page.keyboard.press('Shift+?');
    await expect(page.getByTestId('help-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-panel')).toBeHidden();
    await page.getByRole('button', { name: 'Suchen' }).click();
    await page.getByRole('combobox').fill('?');
    await expect(page.getByTestId('help-panel')).toBeHidden();
    await page.keyboard.press('Escape');
  });

  test('images load and links between pages work', async ({ page }) => {
    await page.goto('/help/einstieg/oberflaeche');
    const image = page.getByRole('img', { name: 'Die Oberfläche: Schiene, Zweitebene, Kopfleiste' });
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await page.goto('/help/akte/post-ablegen');
    await page.getByRole('link', { name: 'Volltext' }).first().click();
    await expect(page).toHaveURL('/help/akte/volltext');
  });

  test('the table of contents, the palette and a page without help', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('navigation', { name: 'Inhaltsverzeichnis' }).getByRole('link', { name: 'Themes' })).toBeVisible();
    await page.getByRole('button', { name: 'Hilfe zu dieser Seite' }).click();
    const panel = page.getByTestId('help-panel');
    await expect(panel).toContainText('Zu dieser Seite gibt es noch keine Hilfe.');
    await expect(panel.getByRole('link', { name: 'Mediathek' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator('body[data-command-palette="ready"]')).toBeAttached();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await palette.getByRole('combobox').fill('Post ablegen');
    await expect(palette.getByText('Hilfe', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/help/akte/post-ablegen');
  });
});
