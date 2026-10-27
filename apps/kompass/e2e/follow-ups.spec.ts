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
    // Nicht „Nichts fällig.“: Ab dem 01.03. ist auch die Wiedervorlage „Jahresabschluss vor der Mitgliederversammlung“
    // des Finanz-Seeds fällig (28.02. nach dem Stichjahr, `scripts/e2e-kalender.sh`). Abgehakt bleibt abgehakt.
    await page.reload();
    await expect(tile.getByRole('heading', { name: 'Fällig' })).toBeVisible();
    await expect(tile.getByText('Antwort abwarten')).toBeHidden();
  });

  test('„nur meine“ ist eine Option der Kachel und bleibt gespeichert', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Anpassen' }).click();
    const sheet = page.getByTestId('dashboard-customize');
    // „Nur meine“ gibt es auch bei „Entwürfe“ — die Zeile der Kachel „Fällig“
    // grenzt die Wahl ein („Löschfällig“ enthält „fällig“, darum die Kennung).
    const followUpsRow = sheet.getByTestId('customize-tile-core-followUps');
    // Die Optionen stehen hinter „Einstellungen“ (Designer 2026-10-17, Frage 3).
    await followUpsRow.getByText('Einstellungen', { exact: true }).click();
    await followUpsRow.getByRole('switch', { name: 'Nur meine' }).click();
    // Der Seed setzt keine Zuständige: „niemand Bestimmtes“ ist nicht „meine“.
    await expect(page.getByTestId('dashboard-tile-core-followUps').getByText('Nichts fällig.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Anpassen' }).click();
    await followUpsRow.getByText('Einstellungen', { exact: true }).click();
    await expect(followUpsRow.getByRole('switch', { name: 'Nur meine' })).toBeChecked();
  });
});
