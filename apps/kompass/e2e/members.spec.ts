import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';
import { STORY_YEAR } from './story-year';

/**
 * Mitglieder (Plan U1): je Seite der wichtigste Weg. Die Daten kommen aus dem Seed des Moduls
 * (`packages/modules/members/src/seed.ts`).
 */
test.describe('members', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  /** Task 2: Liste mit Seed-Mitgliedern, Filter „Nur mit Rückstand“, am Telefon ohne waagerechtes Scrollen. */
  test('Mitgliederliste: Reiter, Rückstand und Telefonbreite', async ({ page }) => {
    await page.goto('/members');
    await expect(page.getByRole('heading', { level: 1, name: 'Mitglieder' })).toBeVisible();
    const rows = page.getByTestId('member-row');
    await expect(rows.filter({ hasText: 'Tilda Wegener' })).toBeVisible();
    // Aktiv ohne Rückstand trägt keine Marke; ein Rückstand zeigt höchstens eine Stufe (Handoff D2).
    await expect(rows.filter({ hasText: 'Jonas Kranich' }).locator('[data-col="status"]')).toBeEmpty();
    const all = await rows.count();

    await page.getByRole('checkbox', { name: 'Nur mit Rückstand' }).check();
    await expect(page).toHaveURL(/arrears=1/);
    await expect.poll(() => rows.count()).toBeLessThan(all);
    for (const row of await rows.all()) await expect(row.getByText(/überfällig|Erinnerung|Mahnung/).first()).toBeVisible();

    // Anträge: ohne Marke, der offene Antrag aus dem Seed.
    await page.getByRole('link', { name: /^Anträge/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Emil Rautenberg');
    // „Auch abgelehnte“: Der abgelehnte Antrag aus dem Seed kommt mit Marke dazu, der offene bleibt ohne.
    await page.getByRole('checkbox', { name: 'Auch abgelehnte' }).check();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Nora Quandt' })).toContainText('abgelehnt');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/members');
    await expect(rows.first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  /** Task 3: Antrag erfassen, aufnehmen, die Nummer steht im Kopf. */
  test('Mitglied anlegen und aufnehmen', async ({ page }) => {
    await page.goto('/members/new');
    await page.getByRole('combobox', { name: 'Kontakt' }).fill('Sandberg');
    await page.getByTestId('contact-option').filter({ hasText: 'Mira Sandberg' }).click();
    await page.getByTestId('member-create-footer').getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/members\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mira Sandberg' })).toBeVisible();
    await expect(page.getByText('Antrag offen')).toBeVisible();

    await page.getByTestId('member-admit').click();
    const dialog = page.getByRole('dialog', { name: 'Mira Sandberg aufnehmen' });
    const number = dialog.getByTestId('admit-number');
    await expect(number).toContainText(/\d{4}/);
    const drawn = (await number.innerText()).match(/\d{4}/)![0];
    await dialog.getByRole('button', { name: 'Aufnehmen' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Mitglied ${drawn}`)).toBeVisible();
  });

  /** Task 4: Mitglied öffnen, Austritt erfassen, Ende zurücknehmen (ohne Rückfrage, mit „Rückgängig“ im Toast). */
  test('Austritt erfassen und Ende zurücknehmen', async ({ page }) => {
    await page.goto('/members');
    await page.getByRole('link', { name: 'Jonas Kranich' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Jonas Kranich' })).toBeVisible();
    await expect(page.getByTestId('member-form')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Beiträge' })).toBeVisible();

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByTestId('member-end').click();
    const dialog = page.getByRole('dialog', { name: 'Mitgliedschaft beenden' });
    await expect(dialog.getByLabel('Endet am')).not.toHaveValue('');
    await dialog.getByRole('button', { name: 'Beenden' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('member-ending')).toContainText('Endet am');

    await page.getByTestId('member-revoke-end').click();
    await expect(page.getByText('Ende zurückgenommen.')).toBeVisible();
    await expect(page.getByTestId('member-ending')).toBeHidden();
  });

  /** Task 5: Beiträge des Jahres, Beitragslauf für das nächste Jahr bis „Versand“, Mahnlauf-Vorschau in Gruppen. */
  test('Beiträge, Beitragslauf und Mahnlauf', async ({ page }) => {
    test.setTimeout(120_000);
    // Der Seed legt die Beiträge des Stichjahrs an; die Seite öffnet das laufende Jahr — von Januar bis August ein
    // anderes, noch ohne Beiträge.
    await page.goto(`/members/fees?year=${STORY_YEAR}`);
    await expect(page.getByTestId('fees-sums')).toBeVisible();
    await expect(page.getByTestId('fee-row').first()).toBeVisible();

    await page.goto('/members/fees/run');
    await page.getByRole('button', { name: 'Vorschau zeigen' }).click();
    await expect(page.getByTestId('run-group-create')).toBeVisible();
    await page.getByTestId('run-footer').getByRole('button', { name: /Beiträge? anlegen/ }).click();
    await expect(page.getByTestId('run-summary')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('dispatch-step')).toBeVisible();
    await expect(page.getByRole('link', { name: /^\d{4}$/ }).first()).toBeVisible();

    await page.goto('/members/fees/dunning');
    await page.getByRole('button', { name: 'Vorschau zeigen' }).click();
    await expect(page.locator('[data-testid^="run-group-"]').first()).toBeVisible();
  });

  /** Task 6: Einstellungen — einen neuen Stand der Beitragsordnung anlegen. */
  test('Einstellungen: neuen Stand der Beitragsordnung anlegen', async ({ page }) => {
    await page.goto('/admin/members?panel=feeSchedule');
    await expect(page.getByTestId('schedule-panel')).toBeVisible();
    await page.getByTestId('schedule-new').first().click();
    const dialog = page.getByRole('dialog', { name: 'Neuen Stand anlegen' });
    const year = new Date().getFullYear() + 2;
    await dialog.getByLabel('Gilt ab').fill(`${year}-01-01`);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: `Ab 01.01.${year}` })).toBeVisible();
  });

  /** Task 7: Am Kontakt steht die Mitgliedschaft als Zeile in „Rollen“; „Öffnen“ führt zum Mitglied. */
  test('Kontakt: Mitgliedschaft in den Rollen', async ({ page }) => {
    await page.goto('/members');
    await page.getByRole('link', { name: 'Tilda Wegener' }).click();
    await page.getByTestId('member-form').getByRole('link', { name: 'Tilda Wegener' }).click();
    await expect(page).toHaveURL(/\/contacts\//);
    const row = page.getByTestId('contact-membership');
    await expect(row).toContainText('Nr. 0001');
    await row.getByRole('link', { name: 'Öffnen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tilda Wegener' })).toBeVisible();
  });
});
