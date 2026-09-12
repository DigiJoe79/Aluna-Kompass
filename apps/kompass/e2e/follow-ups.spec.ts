import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('follow-ups', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('die Startseite zeigt, was fällig ist, und hakt es ab', async ({ page }) => {
    await loginAsAdmin(page);
    const panel = page.getByTestId('due-panel');
    await expect(panel.getByRole('heading', { name: 'Fällig' })).toBeVisible();
    await expect(panel.getByText('Antwort abwarten')).toBeVisible();
    await panel.getByRole('link', { name: /BRF-/ }).first().click();
    await expect(page).toHaveURL(/\/dms\//);
    await page.goto('/');
    await panel.getByRole('checkbox', { name: 'Antwort abwarten erledigen' }).click();
    await expect(panel.getByText('Antwort abwarten')).toBeHidden();
    await expect(panel.getByText('Nichts fällig.')).toBeVisible();
  });

  test('„nur meine“ blendet aus, was anderen gehört, und merkt sich die Wahl', async ({ page }) => {
    await loginAsAdmin(page);
    const panel = page.getByTestId('due-panel');
    await panel.getByRole('switch', { name: 'Nur meine' }).click();
    // Der Seed setzt keine Zuständige: „gilt allen“ ist nicht „meine“.
    await expect(panel.getByText('Antwort abwarten')).toBeHidden();
    await page.reload();
    await expect(panel.getByRole('switch', { name: 'Nur meine' })).toBeChecked();
  });
});
