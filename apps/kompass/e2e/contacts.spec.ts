import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('contacts', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('creates a person and finds it again by name', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Anrede').fill('Frau');
    await dialog.getByLabel('Vorname').fill('Anna');
    await dialog.getByLabel('Nachname').fill('Berger');
    await dialog.getByLabel('Straße').fill('Musterweg 1');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();

    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
    await page.getByLabel('Suche').fill('berger');
    await expect(page.getByRole('row', { name: /Anna Berger/ })).toBeVisible();
  });

  test('finds a contact by a phone number and filters the list by role', async ({ page }) => {
    await page.goto('/contacts');

    // Die Beispieldaten: Tomas Leitner (partner, Telefon), Mira Sandberg (interested).
    await page.getByLabel('Suche').fill('123 456789');
    await expect(page.getByRole('row', { name: /Leitner/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Sandberg/ })).toHaveCount(0);

    await page.getByLabel('Suche').fill('');
    await page.getByLabel('Rolle').selectOption('interested');
    await expect(page.getByRole('row', { name: /Sandberg/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Leitner/ })).toHaveCount(0);
  });

  /** Wie in der Tierliste (Befund Joe, 2026-09-30): Die Felder lasen die Adresse nur beim ersten Rendern. */
  test('die Filterfelder folgen der Adresse, auch wenn sie von außen wechselt', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByLabel('Rolle').selectOption('interested');
    await expect(page).toHaveURL(/role=interested/);
    await page.getByRole('navigation').getByRole('link', { name: 'Kontakte' }).first().click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(page.getByLabel('Rolle')).toHaveValue('');
  });

  test('gives a role, shows the address block and blocks deletion while a hold runs', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Kontakt anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art').selectOption('person');
    await dialog.getByLabel('Nachname').fill('Klein');
    await dialog.getByLabel('Straße').fill('Musterweg 2');
    await dialog.getByLabel('PLZ').fill('12345');
    await dialog.getByLabel('Ort').fill('Musterstadt');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('row', { name: /Klein/ }).getByRole('link').first().click();

    // Der Anschriftsblock steht mehrzeilig da, so wie er ins Fensterkuvert fällt.
    await expect(page.getByTestId('postal-address')).toContainText('Musterweg 2');
    await expect(page.getByTestId('postal-address')).toContainText('12345 Musterstadt');

    await page.getByRole('button', { name: 'Rolle hinzufügen' }).click();
    await page.getByRole('dialog').getByLabel('Rolle').selectOption('interested');
    await page.getByRole('dialog').getByLabel('Seit').fill('2026-03-15');
    await page.getByRole('dialog').getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Interessiert' })).toBeVisible();

    // Solange die Rolle läuft, hält sie den Kontakt — der Löschknopf ist aus und sagt warum.
    await expect(page.getByRole('button', { name: 'Kontakt löschen' })).toBeDisabled();
    await expect(page.getByTestId('retention-holds')).toContainText('Rolle Interessiert');
    await expect(page.getByTestId('retention-holds')).toContainText('31.12.2028');
  });

  test('bearbeitet einen Kontakt: Anschrift ergänzen, und ein veralteter Stand wird abgewiesen', async ({ page, context }) => {
    await page.goto('/contacts');
    // Mittelweg Zeilenklick (Joe 2026-10-04, release-0.2.6.md): Der Name trägt die Fläche über der ganzen Zeile,
    // ein Klick irgendwo in die Zeile öffnet den Kontakt. Charge 1 hielt hier das Gegenteil fest.
    // (Mit der Maus statt `cell.click()`: Die Fläche gehört dem Link in der ersten Zelle, nicht der angeklickten.)
    const cell = page.getByRole('row', { name: /Sandberg/ }).getByRole('cell').nth(1);
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    await page.mouse.click(box!.x + 4, box!.y + 4);
    await expect(page).toHaveURL(/\/contacts\/[0-9A-Z]{26}$/);
    await page.getByRole('button', { name: 'Kontakt bearbeiten' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Nachname')).toHaveValue('Sandberg');
    await dialog.getByLabel('Straße').fill('Lindenallee 7');
    await dialog.getByLabel('PLZ').fill('54321');
    await dialog.getByLabel('Ort').fill('Beispielheim');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('postal-address')).toContainText('Lindenallee 7');
    await expect(page.getByTestId('postal-address')).toContainText('54321 Beispielheim');

    // Die Maske ist offen, dann ändert jemand anders den Kontakt — Speichern darf das nicht überschreiben.
    await page.getByRole('button', { name: 'Kontakt bearbeiten' }).click();
    await expect(dialog.getByLabel('Straße')).toHaveValue('Lindenallee 7');
    const other = await context.newPage();
    await other.goto(page.url());
    await other.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await other.getByRole('button', { name: 'Kontakt bearbeiten' }).click();
    await other.getByRole('dialog').getByLabel('Ort').fill('Zwischenstadt');
    await other.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
    await expect(other.getByTestId('postal-address')).toContainText('Zwischenstadt');
    await other.close();

    await dialog.getByLabel('Ort').fill('Spätstadt');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByRole('alert')).toContainText('wurde inzwischen geändert');
    await page.reload();
    await expect(page.getByTestId('postal-address')).toContainText('Zwischenstadt');
  });

  test('das Protokoll zeigt den Namen live aus dem Kontakt, gespeichert ist nur die Art der Änderung', async ({ page }) => {
    await page.goto('/admin/audit?action=contacts.create');
    const row = page.getByRole('table').getByRole('row').filter({ hasText: 'Sandberg' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Kontakt angelegt');
    await expect(row).not.toContainText('Sandberg angelegt');
  });

  test('sortiert die Kontakte über den Spaltenkopf', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByRole('button', { name: 'Sortieren nach Ort' }).click();
    await expect(page).toHaveURL(/sort=city&dir=desc/);
    await page.getByRole('button', { name: 'Sortieren nach Ort' }).click();
    await expect(page).toHaveURL(/dir=asc/);
    const cities = await page.getByRole('row').locator('td:nth-child(4)').allTextContents();
    expect([...cities].sort((a, b) => a.localeCompare(b, 'de'))).toEqual(cities);
  });
});
