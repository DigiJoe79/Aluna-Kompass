import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';
import { STORY_YEAR } from './story-year';

/**
 * Plan E6b Task 10 — der Weg einer Auslandsrechnung (Spec E6, Ablauf): Ausgabe an einen erfundenen Anbieter aus Irland →
 * Prüffrage § 13b → „Ja“ → Berichtigung der schon abgegebenen Voranmeldung Q2 unter Fristen → Seite der Voranmeldung →
 * Festschreiben und Abgabe → Merkmal am Kontakt. Seed: Kleinunternehmer und Unternehmer, Q2 des Stichjahres festgeschrieben
 * und abgegeben (Kz 46 = 200). Der Kontakt ist je Lauf eindeutig; die Seite prüft relativ (berichtigt = abgegeben + 120).
 */
const euro = (text: string | null) => Number((text ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));

test.describe('finance VAT advance return (Plan E6b)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Prüffrage, Ja, Berichtigung unter Fristen, Festschreiben und Abgabe', async ({ page }) => {
    const name = `Anzeigenwerk Dublin ${Date.now().toString(36)}`;

    // 1. Ein eigener Anbieter aus Irland.
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const contactDialog = page.getByRole('dialog');
    await contactDialog.getByLabel('Art').selectOption('organization');
    await contactDialog.getByLabel('Name', { exact: true }).fill(name);
    await contactDialog.getByLabel('Land').fill('IE');
    await contactDialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

    // 2. Ausgabe im Juni: Die Prüffrage erscheint, „Ja, § 13b“ setzt das Kennzeichen aus der Prüffrage.
    await page.goto('/finance/entries/new?template=expense');
    await page.getByLabel('Datum').fill(`${STORY_YEAR}-06-20`);
    await page.getByLabel('Text').fill('Werbeanzeigen Juni');
    const accountCard = page.getByTestId('finance-account-card');
    await accountCard.getByLabel('Konto').selectOption({ label: 'Vereinskonto' });
    await accountCard.getByLabel('Betrag').fill('120,00');
    const allocationCard = page.getByTestId('finance-allocation-card');
    const rows = allocationCard.getByTestId('split-row');
    await allocationCard.getByRole('button', { name: 'Zeile hinzufügen' }).click();
    await rows.nth(0).getByLabel('Kategorie').selectOption({ label: 'Werbung und Spendenaufrufe' });
    await rows.nth(0).getByLabel('Betrag').fill('120,00');
    await rows.nth(0).getByRole('combobox', { name: 'Spender/Empfänger' }).fill(name.slice(0, 18));
    await page.getByTestId('contact-option').filter({ hasText: name }).first().click();
    const prompt = page.getByTestId('reverse-charge-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('checkbox')).toBeChecked();
    await prompt.getByRole('button', { name: 'Ja, § 13b' }).click();
    await expect(prompt).toBeHidden();
    await expect(rows.nth(0).getByLabel('Umsatzsteuer')).toHaveValue('rc13bEu');
    await expect(rows.nth(0).locator('[data-tax-origin="prompt"]')).toBeVisible();
    await page.getByRole('button', { name: 'Festschreiben', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page).toHaveURL(/\/finance\/entries\/[0-9A-Z]{26}$/);

    // 3. Unter Fristen steht die Berichtigung Q2 oben, „unverzüglich“, mit dem Weg zur Voranmeldung.
    await page.goto('/finance/deadlines');
    const first = page.getByTestId('deadline-row').first();
    await expect(first).toHaveAttribute('data-kind', 'vatAmendment');
    await expect(first).toContainText('unverzüglich');
    // Der Titel ist der einzige Link (Designer Runde 8, Vorweg 3).
    await first.getByRole('link', { name: `Berichtigte Voranmeldung Q2 ${STORY_YEAR}` }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/vat\\?period=${STORY_YEAR}-Q2$`));

    // 4. Die Seite: Berichtigung offen, Kz 46 berichtigt = abgegeben + 120; festschreiben, Abgabe eintragen.
    await expect(page.getByTestId('vat-header')).toContainText('Berichtigung offen');
    await expect(page.getByTestId('vat-amendment')).toBeVisible();
    const kz46 = page.locator('[data-figure="46"]');
    const cells = kz46.getByRole('cell');
    const filed = euro(await cells.nth(2).textContent());
    const amended = euro(await cells.nth(3).textContent());
    expect(amended).toBe(filed + 120);
    await page.getByTestId('vat-finalize').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page.getByTestId('vat-finalize')).toBeHidden();
    await page.getByTestId('vat-filing-edit').click();
    const dialog = page.getByTestId('vat-dialog');
    await dialog.getByRole('button', { name: 'Eintragen' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('vat-header')).not.toContainText('Berichtigung offen');
    await page.goto('/finance/deadlines');
    await expect(page.locator(`[data-kind="vatAmendment"]`)).toHaveCount(0);

    // 5. Am Kontakt steht das Merkmal, EU.
    await page.goto('/contacts');
    await page.getByRole('searchbox', { name: 'Suchen' }).fill(name);
    const href = await page.getByRole('link', { name }).getAttribute('href');
    await page.goto(href!);
    const vat = page.getByTestId('contact-vat');
    await expect(vat.getByLabel('Rechnungen mit Umkehr der Steuerschuld (§ 13b)')).toBeChecked();
    await expect(vat.getByRole('radio', { name: 'in der EU' })).toBeChecked();
  });
});
