import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const NAV = 'Bereiche der Vereinseinstellungen';

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
    const list = page.getByRole('navigation', { name: NAV });
    const firstField = page.getByLabel('Vereinsname');
    const listBox = await list.boundingBox();
    const fieldBox = await firstField.boundingBox();
    if (!listBox || !fieldBox) throw new Error('Reiter nicht sichtbar');

    expect(listBox.y + listBox.height).toBeLessThanOrEqual(fieldBox.y + 1);
    // Und sie ist eine Leiste, kein hoher Kasten: deutlich breiter als hoch.
    expect(listBox.width).toBeGreaterThan(listBox.height);
  });

  /**
   * Die Speicherleiste klebt ab 640 × 600 px am unteren Rand (MUSTER § B). Bis 0.2.9 tat sie das auf den meisten
   * Seiten nie, weil die Formularkarte `overflow-hidden` trug — `position: sticky` stand trotzdem im CSS; geprüft wird
   * deshalb die Lage im Fenster, nicht die Eigenschaft (Befund 39). Auf dem Telefon klebt sie nicht.
   */
  test('die Speicherleiste klebt am Rechner, auf dem Telefon steht sie am Ende der Karte', async ({ page }) => {
    const bar = page.locator('[data-slot="form-action-bar"]');
    const main = page.locator('main');
    const toMiddle = () =>
      main.evaluate((el) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
        return el.scrollHeight - el.clientHeight;
      });

    expect(await toMiddle()).toBeGreaterThan(200);
    await expect(bar).toHaveAttribute('data-stuck', '');
    const desk = await bar.boundingBox();
    if (!desk) throw new Error('Speicherleiste fehlt');
    expect(desk.y).toBeGreaterThanOrEqual(0);
    expect(desk.y + desk.height).toBeLessThanOrEqual(800 + 1);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await toMiddle()).toBeGreaterThan(400);
    await expect(bar).toHaveCSS('position', 'static');
    const phone = await bar.boundingBox();
    if (!phone) throw new Error('Speicherleiste fehlt');
    expect(phone.y).toBeGreaterThan(844);
  });

  test('fragt beim Verlassen mit ungespeicherten Änderungen nach, der Bereichswechsel nicht', async ({ page }) => {
    await page.getByLabel('Vereinsname').fill('Ungespeichert e.V.');
    // Bereichswechsel im Formular: Die Eingaben bleiben, also keine Rückfrage.
    await page.getByRole('navigation', { name: NAV }).getByRole('link').nth(1).click();
    await expect(page).toHaveURL(/panel=/);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Ein Link aus der Seite hinaus fragt.
    await page.getByRole('link', { name: 'Projekte' }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Eine Änderung ist noch nicht gespeichert');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page).toHaveURL(/\/admin\/settings/);
    await page.getByRole('link', { name: 'Projekte' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Seite verlassen' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('saves changed fields, shows the pending counter and audits', async ({ page }) => {
    await page.getByLabel('Vereinsname').fill('Aluna Musterverein e.V.');
    // Der Seed trägt schon „Musterstadt“ ein (F6a) — eine Änderung braucht einen anderen Ort.
    await page.getByLabel('Ort').fill('Beispielstadt');
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Einstellungen gespeichert' })).toContainText('Einstellungen gespeichert');
    await page.reload();
    await expect(page.getByLabel('Vereinsname')).toHaveValue('Aluna Musterverein e.V.');
    await page.goto('/admin/audit');
    // Die Einstellung mit ihrer Beschriftung, nicht mit ihrem Schlüssel (Joe 2026-10-09).
    await expect(page.getByRole('row', { name: /Einstellung · Vereinsname/ }).first()).toBeVisible();
  });

  test('behält Änderungen über einen Reiterwechsel und speichert alle zusammen', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: NAV });
    await page.goto('/admin/settings?panel=organization');
    await page.getByLabel('Vereinsname').fill('Testverein Reiter e.V.');
    await nav.getByRole('link', { name: 'Darstellung' }).click();
    await expect(page).toHaveURL(/panel=display/);
    await page.getByLabel('Datumsformat').selectOption('iso');
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('2 Änderungen noch nicht gespeichert')).toBeHidden();
    await page.goto('/admin/settings?panel=organization');
    await expect(page.getByLabel('Vereinsname')).toHaveValue('Testverein Reiter e.V.');
    await nav.getByRole('link', { name: 'Darstellung' }).click();
    await expect(page.getByLabel('Datumsformat')).toHaveValue('iso');
  });

  test('ein unbekannter Bereich in der Adresse zeigt den ersten', async ({ page }) => {
    await page.goto('/admin/settings?panel=quatsch');
    await expect(page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Verein' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Vereinsname')).toBeVisible();
  });

  test('marks the tab with a validation error and keeps the input', async ({ page }) => {
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Verein' }).click();
    await page.getByLabel('Kontakt-E-Mail').fill('keine-mail');
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Bank' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('navigation', { name: NAV }).getByRole('link', { name: /Verein/ })).toHaveAttribute('data-invalid', 'true');
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: /Verein/ }).click();
    await expect(page.getByText('Bitte eine gültige E-Mail-Adresse eingeben.', { exact: true })).toBeVisible();
    // Die Box oben nennt das Feld mit seiner Meldung (Befund 6, 0.2.4), unter dem ganzen Schlüssel der Einstellung.
    await expect(page.getByText('Kontakt-E-Mail: Bitte eine gültige E-Mail-Adresse eingeben.')).toBeVisible();
    await expect(page.getByLabel('Kontakt-E-Mail')).toHaveValue('keine-mail');
  });

  test('tax tab shows no incomplete alert once finance records the notice, and no statutory purpose', async ({ page }) => {
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Steuer & Bescheide' }).click();
    // Seit F6a erfasst der Finanz-Seed den Freistellungsbescheid; Finanzamt, Steuernummer und Bescheid stehen damit (E22).
    await expect(page.getByTestId('managed-field-value').first()).toBeVisible();
    // Der Kasten „Angaben unvollständig“ ist seit K10 Charge 2 eine Warnung (`status`), kein `alert`.
    await expect(page.locator('main').getByRole('status').filter({ hasText: 'unvollständig' })).toHaveCount(0);
    // Befund 31 (0.2.1): Den Zweck führt der Bescheid; das Feld hier las niemand.
    await expect(page.getByLabel('Satzungszweck')).toHaveCount(0);
  });

  test('geführte Felder zeigen Wert, Kennzeichen und den Weg, kein Eingabefeld', async ({ page }) => {
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Bank' }).click();
    await expect(page.getByText('Wird unter Einstellungen → Finanzen → Bankkonten und Kassen am Hauptkonto geführt.')).toHaveCount(1);
    for (const label of ['IBAN', 'BIC', 'Bankname']) await expect(page.getByLabel(label)).toHaveCount(0);
    const bankValues = page.getByTestId('managed-field-value');
    await expect(bankValues).toHaveCount(3);
    for (const value of await bankValues.all()) await expect(value).not.toHaveText('');
    const bankLinks = page.getByRole('link', { name: /^geführt unter Bankkonten$/ });
    await expect(bankLinks).toHaveCount(3);
    await expect(bankLinks.first()).toHaveAttribute('href', '/admin/finance?panel=accounts');

    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Steuer & Bescheide' }).click();
    await expect(page.getByText('Wird unter Finanzen → Spenden → Bescheide geführt.')).toHaveCount(1);
    await expect(page.getByLabel('Steuernummer')).toHaveCount(0);
    const noticeLinks = page.getByRole('link', { name: /^geführt unter Bescheide$/ });
    await expect(noticeLinks).toHaveCount(4);
    await expect(noticeLinks.first()).toHaveAttribute('href', '/finance/donations/notices');
  });

  test('der Hinweis Steuer unvollständig zählt geführte Felder nicht', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    const row = page.getByTestId('notice-row').filter({ hasText: 'Freistellungsbescheid' });
    await row.getByTestId('notice-menu').click();
    await page.getByRole('menuitem', { name: 'Irrtümlich erfasst' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund').fill('Für die Prüfung zurückgenommen');
    await dialog.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/admin/settings');
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Steuer & Bescheide' }).click();
    // Der Kasten „Angaben unvollständig“ ist seit K10 Charge 2 eine Warnung (`status`), kein `alert`.
    await expect(page.locator('main').getByRole('status').filter({ hasText: 'unvollständig' })).toHaveCount(0);
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
    await page.getByRole('navigation', { name: NAV }).getByRole('link', { name: 'Branding' }).click();
    await page.getByRole('button', { name: 'Logo: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByRole('button', { name: /logo-/ }).click();
    await expect(chooser).toBeHidden();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'gespeichert' })).toContainText('gespeichert');

    await page.goto('/admin/media');
    await page.getByRole('row', { name: /logo-/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Logo des Vereins');
  });
});
