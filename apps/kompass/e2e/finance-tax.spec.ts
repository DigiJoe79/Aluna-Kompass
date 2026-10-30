import { expect, test } from './fixtures';
import { loginAsAdmin, openFiscalYear, resetDatabase } from './helpers';
import { FILED_TAX_PERIOD, STORY_YEAR } from './story-year';

/**
 * Rechenschaft D2 — Seite „Steuererklärung“. Seed: die drei abgeschlossenen Jahre sind ein Zeitraum (`FILED_TAX_PERIOD`),
 * im Mai abgegeben, ohne Bescheid; das Stichjahr ein offener Zeitraum ohne Angaben — das Satzungsdatum schlägt Gremien als Hinweis vor.
 */
const missingIn = async (page: import('@playwright/test').Page) => Number((await page.locator('[data-slot="page-header-title"]').locator('..').textContent())?.match(/(\d+) Angaben? fehl/)?.[1] ?? 0);

test.describe('finance tax return (Rechenschaft D2)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Angaben im offenen Zeitraum speichern: weniger fehlt, auch nach dem Neuladen', async ({ page }) => {
    await page.goto('/finance/tax');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Steuererklärung ${STORY_YEAR}`);
    const before = await missingIn(page);
    expect(before).toBeGreaterThan(3);
    await expect(page.getByTestId('gem-missing')).toHaveCount(before);

    await page.getByTestId('answer-churchPurposes-no').click();
    await page.getByTestId('answer-charitablePurposes-no').click();
    await page.getByTestId('answer-gratuitousBenefits-no').click();
    // Das Satzungsdatum aus Gremien steht nur als Hinweis daneben (G7) — das Feld bleibt leer, gespeichert wird es nicht.
    await expect(page.locator('#answer-statuteDate')).toHaveValue('');
    await expect(page.getByTestId('answer-statuteDate-take')).toBeVisible();
    await page.getByTestId('tax-answers-save').click();
    await expect(page.getByTestId('gem-missing')).toHaveCount(before - 3);
    await page.reload();
    await expect(page.getByTestId('gem-missing')).toHaveCount(before - 3);
    expect(await missingIn(page)).toBe(before - 3);
    await expect(page.getByTestId('answer-churchPurposes-no')).toHaveAttribute('data-checked', '');
  });

  test('Bescheid zum abgegebenen Zeitraum erfassen und eine Wiedervorlage daran anlegen', async ({ page }) => {
    await page.goto('/finance/tax');
    const select = page.getByTestId('tax-period-select');
    const value = await select.locator('option', { hasText: `${FILED_TAX_PERIOD}, abgegeben` }).getAttribute('value');
    await select.selectOption(value!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Steuererklärung ${FILED_TAX_PERIOD}`);
    const notice = page.getByTestId('requirement-notice');
    await expect(notice).toHaveAttribute('data-blocked', 'false');
    await expect(notice).toHaveAttribute('data-done', 'false');

    await page.getByTestId('tax-file-notice').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Veranlagungszeitraum')).toHaveValue(FILED_TAX_PERIOD);
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Musterstadt');
    await dialog.getByLabel('Steuernummer').fill('99/999/99999');
    await dialog.getByLabel('Datum des Bescheids').fill(`${STORY_YEAR}-09-03`);
    await dialog.getByLabel('Steuerbefreiung ab').fill(`${FILED_TAX_PERIOD.slice(0, 4)}-01-01`);
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Tierschutzes');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await expect(notice).toHaveAttribute('data-done', 'true');

    await page.getByTestId('tax-notice-follow-up').click();
    const followUp = page.getByRole('dialog');
    await followUp.getByLabel('Titel').fill('Hinweise aus dem Bescheid umsetzen');
    await followUp.getByLabel('Fällig am').fill(`${STORY_YEAR}-11-30`);
    await followUp.getByRole('button', { name: 'Anlegen' }).click();
    await expect(followUp).toBeHidden();
    await page.goto('/finance/deadlines');
    await expect(page.getByText('Hinweise aus dem Bescheid umsetzen')).toBeVisible();
  });

  test('Rücklagenspiegel über den Zeitraum: von der Beilage hin, Zeitraum als Rahmen, festschreiben', async ({ page }) => {
    // Vom offenen Zeitraum des Stichjahres aus (dort bewegen sich Rücklagen), mit dem Weg über `?period=`. Den Rücklagenspiegel
    // des abgegebenen Zeitraums schreibt der Seed bewusst nicht fest — das tut dieser Test.
    await page.goto('/finance/tax');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Steuererklärung ${STORY_YEAR}`);
    const openPeriod = await page.getByTestId('tax-period-select').inputValue();
    await page.locator('[data-testid^="requirement-reserveStatement-"]').getByTestId('tax-attachment-reserveStatement-link').click();
    await expect(page).toHaveURL(new RegExp(`/finance/reports/reserveStatement\\?period=${openPeriod}$`));
    await expect(page.locator('#report-period')).toHaveValue(openPeriod);
    await expect(page.locator('#report-year')).toHaveCount(0);

    // Festschreiben über den abgeschlossenen Zeitraum des Vorjahres — der Rahmen wechselt dorthin.
    const filed = await page.locator('#report-period option', { hasText: FILED_TAX_PERIOD }).getAttribute('value');
    await page.locator('#report-period').selectOption(filed!);
    await expect(page).toHaveURL(new RegExp(`period=${filed}$`));
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText(FILED_TAX_PERIOD);
    await page.getByTestId('report-finalize').click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Festschreiben' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('festgeschrieben');
    // Der Hash ist stabil: neu geladen bleibt es die festgeschriebene Fassung.
    await page.reload();
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('festgeschrieben');
  });

  // Befund 34 a: Die Steuererklärung ist abgegeben, die USt-Jahreserklärung des Vorjahres (§ 13b) nicht — Schritt 12
  // bleibt aktiv, nennt das Ergebnis der Steuererklärung und führt zu den Fristen.
  test('Jahresabschluss des Vorjahres: Schritt 12 wartet auf die USt-Jahreserklärung, mit dem Weg zur Steuererklärung', async ({ page }) => {
    await openFiscalYear(page, '/finance/closing', STORY_YEAR - 1);
    const step = page.locator('#step-taxReturn');
    await expect(step).toHaveAttribute('data-state', 'active');
    await expect(step).toContainText('abgegeben am');
    await expect(step.getByRole('link', { name: 'Zu den Fristen' })).toHaveAttribute('href', '/finance/deadlines');
    await step.getByTestId('closing-tax-period').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Steuererklärung ${FILED_TAX_PERIOD}`);
  });
});
