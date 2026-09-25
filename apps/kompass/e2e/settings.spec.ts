import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
  });

  /**
   * Die Reiterleiste gehört über die Inhaltsfläche, nicht daneben. Geprüft wird
   * hier die Geometrie, weil genau die brach: Zwölf Klassen zielten auf ein
   * `data-horizontal`, das im DOM nie stand, und die Wurzel blieb in
   * Zeilenrichtung. Ein Test, der nur klickt, sieht das nicht.
   */
  test('legt die Reiterleiste über die Inhaltsfläche, nicht daneben', async ({ page }) => {
    const list = page.getByRole('tablist').first();
    const panel = page.getByRole('tabpanel').first();
    const listBox = await list.boundingBox();
    const panelBox = await panel.boundingBox();
    if (!listBox || !panelBox) throw new Error('Reiter nicht sichtbar');

    expect(listBox.y + listBox.height).toBeLessThanOrEqual(panelBox.y + 1);
    // Und sie ist eine Leiste, kein hoher Kasten: deutlich breiter als hoch.
    expect(listBox.width).toBeGreaterThan(listBox.height);
  });

  test('saves changed fields, shows the pending counter and audits', async ({ page }) => {
    await page.getByLabel('Vereinsname').fill('Aluna Musterverein e.V.');
    // Der Seed trägt schon „Musterstadt“ ein (F6a) — eine Änderung braucht einen anderen Ort.
    await page.getByLabel('Ort').fill('Beispielstadt');
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Einstellungen gespeichert');
    await page.reload();
    await expect(page.getByLabel('Vereinsname')).toHaveValue('Aluna Musterverein e.V.');
    await page.goto('/admin/audit');
    await expect(page.getByRole('row', { name: /organization.name/ }).first()).toBeVisible();
  });

  test('marks the tab with a validation error and keeps the input', async ({ page }) => {
    await page.getByRole('tab', { name: 'Verein' }).click();
    await page.getByLabel('Kontakt-E-Mail').fill('keine-mail');
    await page.getByRole('tab', { name: 'Bank' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('tab', { name: /Verein/ })).toHaveAttribute('data-invalid', 'true');
    await page.getByRole('tab', { name: /Verein/ }).click();
    await expect(page.getByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
    await expect(page.getByLabel('Kontakt-E-Mail')).toHaveValue('keine-mail');
  });

  test('tax tab shows no incomplete alert once finance records the notice, and the purpose counter', async ({ page }) => {
    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    // Seit F6a erfasst der Finanz-Seed den Freistellungsbescheid; Finanzamt, Steuernummer und Bescheid stehen damit (E22).
    await expect(page.getByLabel('Satzungszweck')).toBeVisible();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await page.getByLabel('Satzungszweck').fill('Förderung des Tierschutzes');
    await expect(page.getByText('26 von 500 Zeichen')).toBeVisible();
  });

  test('geführte Felder zeigen Wert, Kennzeichen und den Weg, kein Eingabefeld', async ({ page }) => {
    await page.getByRole('tab', { name: 'Bank' }).click();
    await expect(page.getByText('Wird unter Finanzen einrichten → Bankkonten und Kassen am Hauptkonto geführt.')).toHaveCount(1);
    for (const label of ['IBAN', 'BIC', 'Bankname']) await expect(page.getByLabel(label)).toHaveCount(0);
    const bankValues = page.getByTestId('managed-field-value');
    await expect(bankValues).toHaveCount(3);
    for (const value of await bankValues.all()) await expect(value).not.toHaveText('');
    const bankLinks = page.getByRole('link', { name: /^geführt unter Bankkonten$/ });
    await expect(bankLinks).toHaveCount(3);
    await expect(bankLinks.first()).toHaveAttribute('href', '/admin/finance?panel=accounts');

    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    await expect(page.getByText('Wird unter Finanzen → Spenden → Bescheide geführt.')).toHaveCount(1);
    await expect(page.getByLabel('Steuernummer')).toHaveCount(0);
    const noticeLinks = page.getByRole('link', { name: /^geführt unter Bescheide$/ });
    await expect(noticeLinks).toHaveCount(4);
    await expect(noticeLinks.first()).toHaveAttribute('href', '/finance/donations/notices');
  });

  test('der Hinweis Steuer unvollständig zählt geführte Felder nicht', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    const row = page.getByTestId('notice-row').filter({ hasText: 'Freistellungsbescheid' });
    await row.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund').fill('Für die Prüfung zurückgenommen');
    await dialog.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Es ist noch kein Bescheid erfasst.')).toBeVisible();
    const link = page.getByRole('link', { name: 'Bescheid erfassen' });
    await expect(link).toHaveAttribute('href', '/finance/donations/notices');
    await link.click();
    await expect(page).toHaveURL(/\/finance\/donations\/notices$/);
  });

  test('the logo is chosen from the library and saved with the settings', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /logo-/ })).toBeVisible();

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Branding' }).click();
    await page.getByRole('button', { name: 'Logo: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByRole('button', { name: /logo-/ }).click();
    await expect(chooser).toBeHidden();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /logo-/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Logo des Vereins');
  });
});
