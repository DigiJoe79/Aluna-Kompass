import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('follow-ups', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('die Startseite zeigt, was fällig ist, und hakt es ab', async ({ page }) => {
    await loginAsAdmin(page);
    const tile = page.getByTestId('dashboard-tile-core-followUps');
    await expect(tile.getByRole('heading', { name: 'Fällig' })).toBeVisible();
    await expect(tile.getByText('Antwort abwarten')).toBeVisible();
    await tile.getByRole('link', { name: /BRF-/ }).first().click();
    await expect(page).toHaveURL(/\/dms\//);
    await page.goto('/');
    await tile.getByRole('checkbox', { name: 'Antwort abwarten erledigen' }).click();
    await expect(tile.getByText('Antwort abwarten')).toBeHidden();
    await expect(tile.getByText('Nichts fällig.')).toBeVisible();
  });

  test('„nur meine“ ist eine Option der Kachel und bleibt gespeichert', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Anpassen' }).click();
    const sheet = page.getByTestId('dashboard-customize');
    // „Nur meine“ gibt es auch bei „Entwürfe“ — die Zeile der Kachel „Fällig“
    // grenzt die Wahl ein.
    const followUpsRow = sheet.getByRole('listitem').filter({ hasText: 'Fällig' });
    await followUpsRow.getByRole('switch', { name: 'Nur meine' }).click();
    // Der Seed setzt keine Zuständige: „gilt allen“ ist nicht „meine“.
    await expect(page.getByTestId('dashboard-tile-core-followUps').getByText('Nichts fällig.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Anpassen' }).click();
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Fällig' }).getByRole('switch', { name: 'Nur meine' })).toBeChecked();
  });
});
