import { expect, test } from './fixtures';
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
    await expect(panel.getByRole('heading', { name: 'Hilfe: Brief schreiben' })).toBeVisible();
    await expect(panel).toContainText('Ein Brief entsteht als Entwurf');
    // „Im Handbuch öffnen“ steht im Kopf und öffnet einen neuen Tab (Entwurf E4).
    await expect(panel.getByRole('link', { name: 'Im Handbuch öffnen' })).toHaveAttribute('target', '_blank');
    await page.goto(await panel.getByRole('link', { name: 'Im Handbuch öffnen' }).getAttribute('href') ?? '');
    await expect(page).toHaveURL('/help/akte/brief-schreiben');
    const toc = page.getByRole('navigation', { name: 'Inhaltsverzeichnis' });
    await expect(toc.getByRole('link', { name: 'Brief schreiben' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brief schreiben');
    const crumbs = page.getByRole('navigation', { name: 'Brotkrume' });
    await expect(crumbs).toContainText('Handbuch');
    await expect(crumbs).toContainText('Akte');
    await expect(crumbs.getByText('Brief schreiben')).toHaveAttribute('aria-current', 'page');
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

  // E4 „Hilfe neben der Seite“ (Designer 2026-10-17): ab `lg` eine Nebenspalte ohne Abdunkeln; sie verdrängt das
  // Seitenpanel „Bestände“, bleibt beim Seitenwechsel offen und gibt den Fokus beim Schließen an den Knopf zurück.
  test('Journal mit Hilfe daneben: Nebenspalte statt Blatt, Seitenpanel eingeklappt, bleibt beim Seitenwechsel offen', async ({ page }) => {
    // Ab 1680 px steht das Seitenpanel von selbst neben dem Journal (07-1 B33).
    await page.setViewportSize({ width: 1720, height: 900 });
    await page.goto('/finance/entries');
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
    const button = page.getByRole('button', { name: 'Hilfe zu dieser Seite' });
    await button.click();
    const aside = page.getByRole('complementary', { name: 'Hilfe' });
    await expect(aside).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(aside.getByRole('heading', { level: 2 }).first()).toBeFocused();
    await expect(page.getByTestId('finance-side-panel')).toBeHidden();
    // Die Seite bleibt bedienbar: ein Link im Inhalt führt weiter, die Hilfe folgt.
    await page.getByRole('link', { name: 'Offene Zahlungen', exact: true }).first().click();
    await expect(page).toHaveURL(/\/finance\/open-items/);
    await expect(aside).toBeVisible();
    await expect(button).not.toBeFocused();
    await page.goto('/finance/entries');
    await expect(aside).toBeVisible();
    await aside.getByRole('button', { name: 'Hilfe schließen' }).click();
    await expect(aside).toBeHidden();
    await expect(button).toBeFocused();
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
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
    await expect(page.getByRole('navigation', { name: 'Inhaltsverzeichnis' }).getByRole('link', { name: 'Erscheinungsbild' })).toBeVisible();
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
