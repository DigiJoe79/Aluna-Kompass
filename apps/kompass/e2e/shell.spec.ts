import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows the environment banner, organisation name and admin navigation', async ({ page }) => {
    await expect(page.getByTestId('env-banner')).toContainText('TESTUMGEBUNG');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByText('Musterverein e.V.')).toBeVisible();
    for (const label of ['Startseite', 'Nutzer', 'Rollen', 'Einstellungen', 'Themes', 'Module', 'Änderungsprotokoll', 'Dokumente', 'Backup']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('collapses the sidebar with [ and remembers it', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav).toHaveCSS('width', '248px');
    await page.keyboard.press('[');
    await expect(nav).toHaveCSS('width', '56px');
    await page.reload();
    await expect(nav).toHaveCSS('width', '56px');
    await nav.getByRole('link', { name: 'Nutzer' }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Nutzer');
  });

  test('switches colour scheme from the user menu and logs out', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('turns into a drawer below 1180px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Nutzer' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
