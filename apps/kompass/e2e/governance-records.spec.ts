import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * Gremien, zweite Oberfläche (Plan U2): genau drei Fälle mit Schaden der Stufe Daten — das Regelwerk speichert, was
 * man einträgt (Fall 1), ein Umlauf wird zum Beschluss mit Nummer (Fall 2), die Registeranmeldung hält Beglaubigung und
 * Transparenzfragen fest (Fall 3).
 */
test.describe('governance records', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  // Grund: Daten — ein falsches Regelwerk rechnet jede Mehrheit falsch.
  test('Fall 1: Regelwerk bearbeiten, Satzungsmehrheit 2/3 mit Fundstelle, Lesesicht zeigt sie', async ({ page }) => {
    await page.goto('/governance/statutes');
    await page.getByRole('row', { name: /gültig/ }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/governance\/statutes\/[0-9A-Z]{26}$/);
    const statuteUrl = page.url();
    await page.getByRole('link', { name: 'Regelwerk bearbeiten' }).click();
    const row = page.locator('[data-rule$=":majority.statute"]').first();
    await row.getByLabel('Zähler').fill('2');
    await row.getByLabel('Nenner').fill('3');
    await row.getByLabel(/^Fundstelle/).fill('§ 99 Satzung');
    // Der gültige Stand ist eingetragen: Sein Regelwerk ändert sich nur mit Grund (G-5), der ins Änderungsprotokoll geht.
    await page.getByLabel('Grund der Änderung').fill('Fundstelle der Satzungsmehrheit nachgetragen');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Stand gespeichert.').first()).toBeVisible();
    await page.goto(statuteUrl);
    await page.reload();
    await expect(page.locator('[id="rule-majority.statute"]').first()).toContainText('§ 99 Satzung');
    await expect(page.locator('[id="rule-majority.statute"]').first()).toContainText('zwei Drittel');
  });
  // Grund: Daten — aus dem Umlauf entsteht ein Beschluss mit Nummer.
  test('Fall 2: Umlauf anlegen, alle stimmen zu, Beschluss eintragen, Nummer in der Liste', async ({ page }) => {
    await page.goto('/governance/circulars/new');
    await page.getByLabel('Antrag', { exact: true }).fill('Anschaffung Testgerät');
    const deadline = page.getByLabel('Antworten bis');
    const requested = await page.getByLabel('Angefragt am').inputValue();
    await deadline.fill(requested);
    await page.getByTestId('circular-create-save').click();
    await expect(page).toHaveURL(/\/governance\/circulars\/[0-9A-Z]{26}$/);
    const circularUrl = page.url();
    const open = page.getByRole('button', { name: 'Antwort eintragen …' });
    await expect(open.first()).toBeVisible();
    for (let left = await open.count(); left > 0; left--) {
      await open.first().click();
      await page.getByTestId('answer-yes').click();
      await page.getByTestId('response-save').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(open).toHaveCount(left - 1);
    }
    await expect(page.getByText(/Zustande gekommen am/)).toBeVisible();
    await page.getByRole('button', { name: 'Beschluss eintragen' }).click();
    await page.getByTestId('decide-save').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/governance/resolutions');
    await expect(page.getByRole('row', { name: /Anschaffung Testgerät/ })).toContainText(/B-\d{4}-\d{3}/);
    await page.goto(circularUrl);
    await page.reload();
    await expect(page.getByText(/eingetragen als B-\d{4}-\d{3}/)).toBeVisible();
  });
  // Grund: Daten — Registervorgang und Meldepflicht zum Transparenzregister.
  test('Fall 3: Anmeldung beglaubigen, Fragen zum Transparenzregister speichern', async ({ page }) => {
    await page.goto('/governance/register');
    await page.getByRole('row', { name: /fällig/ }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/governance\/register\/[0-9A-Z]{26}$/);
    await page.getByRole('button', { name: 'Beglaubigung vermerken …' }).click();
    await page.getByTestId('filing-dialog-save').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('filing-steps')).toContainText('Beglaubigt am');
    for (const key of ['foreignBoardMember', 'earlierOwnReport', 'controlOtherwise']) await page.getByTestId(`${key}-no`).click();
    await page.getByTestId('transparency-save').click();
    await expect(page.getByText('Gespeichert.').first()).toBeVisible();
    await page.reload();
    for (const key of ['foreignBoardMember', 'earlierOwnReport', 'controlOtherwise']) await expect(page.getByTestId(`${key}-no`)).toBeChecked();
    await expect(page.getByTestId('filing-steps')).toContainText('Beglaubigt am');
  });
});
