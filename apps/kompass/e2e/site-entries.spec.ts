import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

test('ein bestehender Eintrag lässt sich speichern, danach verwerfen und erneut speichern', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/c/news');
  await page.getByRole('row').first().getByRole('link').click();
  await waitForHydration(page, '[name="title.de"]');
  const title = page.locator('[name="title.de"]');
  await title.fill('Erster Stand');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  // Nach dem Speichern ist nichts mehr offen (U4).
  await expect(page.getByText(/noch nicht gespeichert/)).toHaveCount(0);

  await title.fill('Verworfen');
  await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
  await page.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(title).toHaveValue('Erster Stand');

  // Zweites Speichern ohne Neuladen: kein „Inzwischen geändert“ (Review Focus 1).
  await title.fill('Zweiter Stand');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.locator('[name="title.de"]')).toHaveValue('Zweiter Stand');
});

test('ein Eintrag wird auf seiner Seite gelöscht, unter „Weitere Aktionen“, nicht in der Liste', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/c/news');
  // Die Liste kennt keinen Löschen-Knopf (MUSTER.md § C: Löschen steht im Seitenkopf der Detailseite).
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
  const before = await page.getByRole('row').count();
  await page.getByRole('row').first().getByRole('link').click();
  await waitForHydration(page, '[name="title.de"]');
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Eintrag löschen …' }).click();
  const dialog = page.getByRole('alertdialog');
  const withdraw = dialog.getByRole('button', { name: 'Zurückziehen' });
  const remove = dialog.getByRole('button', { name: 'Löschen' });
  // Zwei Stufen: Ist der Eintrag veröffentlicht, zuerst zurückziehen.
  await expect(dialog.getByText(/Das ist noch veröffentlicht\.|Der Inhalt wird entfernt\./)).toBeVisible();
  if (await withdraw.isVisible()) await withdraw.click();
  await expect(dialog.getByText('Der Inhalt wird entfernt.')).toBeVisible();
  await remove.click();
  await expect(page).toHaveURL(/\/site\/c\/news$/);
  await expect(page.getByRole('row')).toHaveCount(before - 1);
});

async function startPasswordFor(page: Page, name: string): Promise<string> {
  await page.goto('/admin/users');
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
  const pw = (await page.getByTestId('start-password').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
  return pw;
}

async function loginFirstTime(page: Page, email: string, startPassword: string): Promise<void> {
  await page.request.post('/logout');
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(startPassword);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByLabel('Startpasswort').fill(startPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill('ein-neues-passwort-2026');
  await page.getByLabel('Passwort wiederholen').fill('ein-neues-passwort-2026');
  await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
  await expect(page).toHaveURL('/');
}

test('Leser sehen Sammlungen ohne Bearbeiten-Knöpfe, ohne Leserecht keine Vorschau', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/admin/roles');
  await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Schriftführung/ }).click();
  await page.getByRole('checkbox', { name: 'Webseite ansehen' }).check();
  await page.getByRole('button', { name: 'Rolle speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');

  const miraPw = await startPasswordFor(page, 'Mira Klein');
  const peterPw = await startPasswordFor(page, 'Peter Lang');

  await loginFirstTime(page, 'mira@kompass.local', miraPw);
  await page.goto('/site/publish/preview');
  // Die Zustandskarte nennt den Zustand als Marke und Titel, nicht als Statuscode (Designer Stufe 2 Nr. 13).
  await expect(page.getByRole('heading', { level: 1, name: 'Diese Seite ist für Ihre Rolle nicht freigegeben.' })).toBeVisible();
  expect((await page.request.get('/site/preview/')).status()).toBe(403);

  await loginFirstTime(page, 'peter@kompass.local', peterPw);
  await page.goto('/site/c/news');
  await expect(page.getByRole('row').first()).toContainText(/Veröffentlicht|Nicht veröffentlicht/);
  await expect(page.getByRole('link', { name: 'Neu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('table').getByRole('link')).toHaveCount(0);
  await page.goto('/site/publish/preview');
  await expect(page.getByRole('heading', { name: 'Webseiten-Vorschau' })).toBeVisible();
});

/**
 * Ausschnitt für alle Bilder (Plan D Task 5): Das Basis-Template gibt dem Team-Foto 1:1 vor — fest, Schwelle 480.
 * Zuschneiden am Feld, speichern mit dem Eintrag; die Mediathek sagt „· zugeschnitten“.
 */
test('schneidet das Foto eines Team-Eintrags zu; die Mediathek zeigt „zugeschnitten“', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/c/team');
  await page.getByRole('row').nth(1).getByRole('link').click();
  await waitForHydration(page, '[name="slug"], [name="name"]');
  await page.getByRole('button', { name: 'Ausschnitt …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ausschnitt' });
  await expect(dialog.getByText('fest für Team')).toBeVisible();
  await expect(dialog.getByText('Gespeichert wird mit dem Eintrag.')).toBeVisible();
  await dialog.getByRole('slider', { name: 'Ausschnitt' }).press('+');
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('1 Änderung noch nicht gespeichert')).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.reload();
  await expect(page.getByTestId('cropped-image')).toBeVisible();

  await page.goto('/admin/media');
  await page.getByRole('radio', { name: 'Liste', exact: true }).click();
  await expect(page.getByText('· zugeschnitten').first()).toBeVisible();
});
