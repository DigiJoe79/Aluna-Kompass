import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Die Projekte liegen im Kern, nicht im abgelösten Webseiten-Modul. Dieser
 * Ablauf lag bis zum Cutover in `website-lists.spec.ts` unter `/website/projects`.
 */
test.describe('projects', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('create with an external link, then publish from the list', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('grundversorgung');
    await page.locator('[name="name.de"]').fill('Grundversorgung');
    await page.getByLabel('Typ').selectOption('ongoing');
    await page.getByRole('button', { name: 'Verweis hinzufügen' }).click();
    await page.getByLabel('Bezeichnung').fill('Spendenseite');
    await page.getByLabel('Adresse (https://…)').fill('https://example.org/spenden/grundversorgung');
    await page.locator('[name="summary.de"]').fill('Futter, Wärme und tierärztliche Versorgung.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.goto('/projects');
    const row = page.getByRole('row', { name: /Grundversorgung/ });
    await expect(row).toContainText('Dauerprojekt');
    await expect(row).toContainText('Spendenseite');
    await row.getByRole('switch').click();
    await expect(row).toContainText('Veröffentlicht');
    // Der Schalter liegt über der Zeilenfläche und öffnet das Projekt nicht nebenbei.
    await expect(page).toHaveURL(/\/projects$/);

    // Ein Klick irgendwo sonst in die Zeile öffnet es (Mittelweg Zeilenklick).
    const cell = row.getByRole('cell').nth(1);
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    await page.mouse.click(box!.x + 4, box!.y + 4);
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
  });

  test('picks an existing image from the library for a project', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByLabel('Datei hochladen').setInputFiles({ name: 'bestand.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('row', { name: /bestand-/ })).toBeVisible();

    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('bestandsprojekt');
    await page.locator('[name="name.de"]').fill('Bestandsprojekt');
    await page.getByRole('button', { name: 'Bild: Wählen' }).click();
    const chooser = page.getByRole('dialog', { name: 'Bild wählen' });
    await chooser.getByLabel('Suchen').fill('bestand');
    await chooser.getByRole('button', { name: /bestand-/ }).click();
    await expect(chooser).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bild entfernen' })).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);
    await expect(page.locator('input[name="imageAssetId"]')).toHaveValue(/^[0-9A-Z]{26}$/);
  });

  test('löscht ein reines Verweis-Projekt, solange es nicht veröffentlicht ist', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('partneraktion');
    await page.locator('[name="name.de"]').fill('Partneraktion');
    await page.getByLabel('Typ').selectOption('shortTerm');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Projekt löschen …' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Partneraktion löschen?' });
    await expect(dialog.getByText('Der Inhalt wird entfernt.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Löschen' }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('row', { name: /Partneraktion/ })).toHaveCount(0);

    await page.goto('/admin/audit');
    await expect(page.getByText('Projekt „Partneraktion“ gelöscht')).toBeVisible();
  });

  test('sortiert nach Name; dann fehlen die Reihenfolge-Knöpfe, „Eigene Reihenfolge“ bringt sie zurück', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('button', { name: 'Nach oben' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Eigene Reihenfolge' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sortieren nach Projekt' }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByRole('button', { name: 'Nach oben' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Eigene Reihenfolge' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page.getByRole('button', { name: 'Nach oben' }).first()).toBeVisible();
  });

  test('Speichern ohne Änderung sagt „Nichts geändert“; auf dem Telefon Speichern oben, Verwerfen und Abbrechen darunter nebeneinander', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('telefonprojekt');
    await page.locator('[name="name.de"]').fill('Telefonprojekt');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    const bar = page.locator('[data-slot="form-action-bar"]');
    await bar.getByRole('button', { name: 'Speichern' }).click();
    await expect(bar.getByText('Nichts geändert')).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    await page.setViewportSize({ width: 390, height: 844 });
    // Die Umbruchlage greift erst nach dem Neuzeichnen: bis dahin wiederholen.
    await expect(async () => {
      const save = await bar.getByRole('button', { name: 'Speichern' }).boundingBox();
      const discard = await bar.getByRole('button', { name: 'Verwerfen' }).boundingBox();
      const cancel = await bar.getByRole('link', { name: 'Abbrechen' }).boundingBox();
      const frame = await bar.boundingBox();
      expect(save!.y).toBeLessThan(discard!.y);
      // Volle Breite der Leiste abzüglich ihres Polsters `px-5` (2 × 20 px, docs/MUSTER.md § I).
      expect(Math.abs(save!.width - (frame!.width - 40))).toBeLessThanOrEqual(2);
      // Darunter „Verwerfen“ und „Abbrechen“ nebeneinander, je eine Hälfte (Designer 2026-10-08).
      expect(Math.abs(discard!.y - cancel!.y)).toBeLessThanOrEqual(1);
      expect(discard!.x).toBeLessThan(cancel!.x);
      expect(Math.abs(discard!.width - cancel!.width)).toBeLessThanOrEqual(2);
      expect(discard!.width).toBeLessThan(save!.width / 2);
    }).toPass();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('Konflikt beim Speichern: zwei Auswege, die eigenen Eingaben erscheinen neben dem neuen Stand', async ({ page, context }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Projekt anlegen' }).click();
    await page.getByLabel('Slug (URL-Teil)').fill('konfliktprojekt');
    await page.locator('[name="name.de"]').fill('Konfliktprojekt');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+$/);

    const other = await context.newPage();
    await other.goto(page.url());
    // Die zweite Seite läuft nicht über die Fixture, ihr `goto` wartet nicht auf React (wie contacts.spec.ts).
    await other.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await other.locator('[name="summary.de"]').fill('Zwischendurch geändert.');
    await other.getByRole('button', { name: 'Speichern' }).click();
    await expect.poll(async () => (await other.reload(), await other.locator('[name="summary.de"]').inputValue())).toBe('Zwischendurch geändert.');

    await page.locator('[name="name.de"]').fill('Mein neuer Name');
    await page.getByRole('button', { name: 'Speichern' }).click();
    const alert = page.locator('[data-slot="form-action-bar"]').getByRole('alert');
    await expect(alert).toContainText('wurde inzwischen geändert');
    await page.getByRole('button', { name: /Ihre Änderungen neben den neuen Stand legen/ }).click();

    await expect(page.getByText('Ihre Eingaben neben dem neuen Stand')).toBeVisible();
    await expect(page.getByText('Ihre Eingabe', { exact: true })).toBeVisible();
    await expect(page.getByText('Mein neuer Name')).toBeVisible();
    await expect(page.locator('[name="name.de"]')).toHaveValue('Konfliktprojekt');
  });
});
