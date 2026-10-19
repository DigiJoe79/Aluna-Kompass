import { associationDay } from './association-day';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/** Das Stichjahr des Seeds (`seedStoryYear`): ab dem 31.08. das laufende Jahr, davor das Vorjahr. */
const storyYear = () => {
  const today = associationDay();
  return today.slice(5) >= '08-31' ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
};

/**
 * Lastschrift (Plan U2): je Seite der wichtigste Weg. Die Daten kommen aus dem Seed der Finanzen
 * (`packages/modules/finance/src/direct-debit/seed.ts`): Lastschrift eingeschaltet mit der Test-Gläubiger-ID der
 * Bundesbank, Mandate in allen Zuständen, Zusagen, ein gebuchter Einzug mit Rückgaben und ein angelegter (verfallen).
 */
test.describe('finance direct debit', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  /** Task 1: Einstellungen › Finanzen › Lastschrift — falsche Prüfziffer am Feld abgelehnt, richtige gespeichert. */
  test('Einstellungen: Gläubiger-ID prüfen und speichern', async ({ page }) => {
    await page.goto('/admin/finance?panel=directDebit');
    const panel = page.getByTestId('direct-debit-panel');
    const creditorId = panel.getByLabel('Gläubiger-Identifikationsnummer');
    await expect(creditorId).toHaveValue('DE98ZZZ09999999999');

    await creditorId.fill('DE98ZZZ09999999998');
    await page.getByTestId('direct-debit-save').click();
    await expect(panel.getByText('Diese Gläubiger-Identifikationsnummer ist ungültig.')).toBeVisible();

    // Die Geschäftsbereichskennung zählt nicht zur Prüfziffer: ABC statt ZZZ ist gültig.
    await creditorId.fill('de98 abc 09999999999');
    await page.getByTestId('direct-debit-save').click();
    await expect(page.getByText('Lastschrift-Einstellungen gespeichert.').first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('direct-debit-panel').getByLabel('Gläubiger-Identifikationsnummer')).toHaveValue('DE98ABC09999999999');
  });

  /** Task 2: drei Reiter mit den Seed-Daten — Marken nur für Abweichungen, Endzustände gedämpft (Handoff 2a § 1.1). */
  test('Lastschrift: Einzüge, Mandate und Zusagen', async ({ page }) => {
    await page.goto(`/finance/direct-debit?year=${storyYear()}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Lastschrift' })).toBeVisible();
    const runs = page.getByTestId('run-row');
    await expect(runs).toHaveCount(2);
    // März: gebucht, eine Rückgabe offen — nur „Rückgabe zu klären“; April: angelegt, nie eingereicht, also verfallen (M41).
    await expect(runs.filter({ hasText: 'Rückgabe zu klären' })).toHaveCount(1);
    await expect(runs.filter({ hasText: 'verfallen' })).toHaveCount(1);

    await page.getByTestId('direct-debit-tab-mandates').click();
    const mandates = page.getByTestId('mandate-row');
    await expect(mandates.filter({ hasText: 'Greta Herbstmann' })).toContainText('Unterschrift fehlt');
    await expect(mandates.filter({ hasText: 'Karl Frühauf' })).toHaveAttribute('data-muted', '');
    await expect(mandates.filter({ hasText: 'Lena Sonnleitner' }).locator('[data-col="status"]')).toBeEmpty();

    await page.getByTestId('direct-debit-tab-pledges').click();
    await expect(page.getByTestId('pledge-row').filter({ hasText: 'Tobias Winterberg' })).toHaveAttribute('data-muted', '');
    await expect(page.getByTestId('pledge-row').filter({ hasText: 'Lena Sonnleitner' })).toContainText('Lastschrift');
  });

  /** Task 3: Einzug anlegen → Datei erzeugen → XML herunterladen → als eingereicht markieren (Handoff 2a § 1.2, § 1.3). */
  test('Neuer Einzug bis zur Einreichung', async ({ page }) => {
    await page.goto('/finance/direct-debit/runs/new');
    // Wählbar sind die Bankarbeitstage bis ein Jahr voraus. Damit heute im Einreichfenster der Bank liegt (frühestens
    // 14 Tage vor Fälligkeit, Feiertage verschieben bis zu vier Tage), der späteste Tag bis heute + 9: Er nimmt die
    // meisten fälligen Raten mit und lässt sich heute als eingereicht markieren.
    const day = page.getByTestId('run-day');
    const cutoff = associationDay(9);
    const values = await day.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    await day.selectOption(values.filter((v) => v <= cutoff).at(-1)!);
    await page.getByTestId('run-show-preview').click();
    await expect(page.getByTestId('dd-group-included')).toBeVisible();
    await page.getByTestId('new-run-footer').getByRole('button', { name: 'Einzug anlegen' }).click();
    await expect(page).toHaveURL(/\/finance\/direct-debit\/runs\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: /^Einzug zum / })).toBeVisible();

    await page.getByTestId('run-build-file').click();
    const xml = page.getByTestId('run-download-xml');
    await expect(xml).toBeVisible();
    const response = await page.request.get((await xml.getAttribute('href'))!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toMatch(/Lastschrift-\d{4}-\d{2}-\d{2}\.xml/);
    expect(await response.text()).toContain('pain.008.001.08');

    await page.getByTestId('run-mark-submitted').click();
    await page.getByTestId('submit-footer').getByRole('button', { name: 'Als eingereicht markieren' }).click();
    await expect(page.getByTestId('submit-dialog')).toBeHidden();
    await expect(page.getByText('eingereicht', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('run-steps')).toContainText('kommt mit dem Kontoauszug');
  });

  /** Task 4: Zusage mit Lastschrift anlegen → das Mandat liegt vorbereitet bereit, „Unterschrift fehlt“ (Handoff 2a § 1.4, § 1.5). */
  test('Zusage mit Lastschrift anlegen', async ({ page }) => {
    await page.goto('/finance/direct-debit/pledges/new');
    await page.getByRole('combobox', { name: 'Spenderin oder Spender' }).fill('Sandberg');
    await page.getByTestId('contact-option').filter({ hasText: 'Mira Sandberg' }).click();
    await page.getByLabel('Betrag').fill('12,00');
    await page.getByLabel('IBAN').fill('DE44 9999 9999 0532 0130 00');
    await page.getByTestId('pledge-create-footer').getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/finance\/direct-debit\/pledges\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mira Sandberg' })).toBeVisible();
    const form = page.getByTestId('pledge-form');
    await expect(form).toContainText('Unterschrift fehlt');

    await form.getByRole('link', { name: 'Mandat öffnen' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^MND-/ })).toBeVisible();
    await expect(page.getByTestId('mandate-steps')).toContainText('Formular unterschreiben lassen');
    await expect(page.getByTestId('mandate-correct')).toBeVisible();
    // Das Formular entsteht in der Akte und öffnet dort — kein Popup.
    await page.getByTestId('mandate-open-form').click();
    await expect(page).toHaveURL(/\/dms\/[^/]+$/);
  });

  /** Task 5: Die Rücklastschrift `AM04` aus dem Seed wartet in der Arbeitsliste; der Vorschlag nennt Einzug, Grund und die zwei Zeilen (Handoff 2a § 1.6). */
  test('Arbeitsliste: Vorschlag zur Rücklastschrift', async ({ page }) => {
    await page.goto('/finance/work');
    await page.getByTestId('work-filter-bar').getByRole('combobox', { name: 'Konto' }).selectOption({ label: 'Vereinskonto' });
    await page.getByRole('listbox', { name: 'Kontoumsätze' }).getByRole('option').filter({ hasText: 'Ruecklastschrift' }).first().click();
    const detail = page.getByTestId('work-detail');
    await expect(detail.getByTestId('suggestion-reasons')).toContainText(/Rückgabe zum Einzug zum .*: End-to-End-Referenz passt\. Grund der Bank: Deckung fehlt/);
    await expect(detail).toContainText('die Rate wird „zurückgegeben“, keine Forderung');
    await expect(detail).toContainText('Gebühr der Bank: −3,00 €');
  });
});
