import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/*
 * Vorschläge einer Quelle prüfen (Spec Vorschlags-Eingang § 6, Plan B). Seed (offen, älteste zuerst): Baxter (Änderung,
 * Konflikt Kurztext, Zweifelsfall Status), Pelle (Änderung am langen Text an drei Stellen), Wilma (neuer Hund,
 * Zweifelsfälle), Nala (Änderung, sauber), Bodo (neuer Hund ohne Foto und Kurztext), Mika (Hinweis „nicht mehr gelistet“), Juno (Zuordnung „Junah“), Ronja (neuer Hund,
 * vollständig). Quelle „Tierbörse Beispielstadt“.
 */
test.describe('Vorschläge prüfen', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('Reiter, Inbox und Kachel zeigen die offenen Vorschläge', async ({ page }) => {
    await page.goto('/animals');
    const tab = page.getByTestId('animals-tab-proposals');
    await expect(tab).toContainText('Vorschläge');
    await expect(tab).toContainText('8');
    await expect(page.getByRole('row', { name: /Baxter/ }).getByTestId('animal-proposal-badge')).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/\/animals\/proposals$/);
    await expect(page.getByRole('row', { name: /Baxter/ })).toContainText('1 Konflikt');
    await page.goto('/');
    await expect(page.getByTestId('dashboard-tile-animals-proposalsOpen')).toContainText('davon 1 mit Konflikt');
  });

  test('nimmt eine Änderung mit Konflikt an: Konfliktfeld bleibt, Status wird übernommen, Wiedervorlage entsteht', async ({ page }) => {
    await page.goto('/animals/proposals');
    await page.getByRole('link', { name: 'Baxter' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Änderung an Baxter');
    await expect(page.getByRole('radiogroup', { name: 'Kurztext' }).getByRole('radio', { name: 'Heute' })).toBeChecked();
    await expect(page.getByTestId('proposal-conflict-trail')).toContainText('Seit dem Vorschlag geändert');
    await page.getByRole('button', { name: 'Annehmen …' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('angenommen mit Änderungen');
    await dialog.getByRole('checkbox', { name: 'Wiedervorlage anlegen' }).click();
    await dialog.getByLabel('Notiz').fill('Neue Fotos ansehen');
    await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/animals?text=Baxter');
    await page.getByRole('link', { name: 'Baxter' }).click();
    await expect(page.getByText('Reserviert').first()).toBeVisible();
    await expect(page.getByTestId('animal-origin')).toContainText('Herkunft: Tierbörse Beispielstadt');
  });

  test('Langtext: Wortunterschied nennt die Stellen und klappt zum ganzen Text auf', async ({ page }) => {
    await page.goto('/animals/proposals?text=Pelle');
    await page.getByRole('link', { name: 'Pelle' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Änderung an Pelle');
    await expect(page.locator('ins', { hasText: 'fünf' }).first()).toBeVisible();
    await expect(page.locator('del', { hasText: 'drei' }).first()).toBeVisible();
    await page.getByRole('button', { name: '6 Stellen geändert · ganzen Text zeigen' }).click();
    await expect(page.getByRole('button', { name: 'gekürzt zeigen' })).toBeVisible();
  });

  test('Alle behalten: Annehmen ist gesperrt, weil sich am Hund nichts ändert', async ({ page }) => {
    await page.goto('/animals/proposals?text=Nala');
    await page.getByRole('link', { name: 'Nala' }).click();
    const accept = page.getByRole('button', { name: 'Annehmen …' });
    await expect(accept).toBeEnabled();
    await page.getByRole('button', { name: 'Alle behalten' }).click();
    await expect(accept).toBeDisabled();
    await expect(page.getByTestId('proposal-no-effect')).toHaveText(/Am Hund ändert sich nichts/);
    await page.getByRole('button', { name: 'Alle übernehmen' }).click();
    await expect(accept).toBeEnabled();
  });

  test('legt einen neuen Hund aus dem Vorschlag an und veröffentlicht ihn', async ({ page }) => {
    await page.goto('/animals/proposals?kind=create');
    await page.getByRole('link', { name: 'Wilma' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neuer Hund: Wilma');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Wilma');
    // Ein Vorschlag bringt nie eine Geschichte mit: kein Reiter dafür (Befund 10).
    await expect(page.getByRole('tab', { name: 'Geschichte' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Zum Feld' }).first().click();
    await expect(page.locator('#birthText-de')).toBeFocused();
    // Titelbild: Marke am gewählten Foto, „Als Titelbild“ nur an den anderen (Befund 10).
    await page.getByRole('tab', { name: 'Texte und Fotos' }).click();
    const tiles = page.getByTestId('proposal-photo');
    await expect(tiles.nth(0).getByRole('button', { name: 'Als Titelbild' })).toHaveCount(0);
    await expect(tiles.nth(0)).toContainText('Titelbild');
    await tiles.nth(1).getByRole('button', { name: 'Als Titelbild' }).click();
    await expect(tiles.nth(1).getByRole('button', { name: 'Als Titelbild' })).toHaveCount(0);
    await tiles.nth(0).getByRole('button', { name: 'Als Titelbild' }).click();
    await page.getByRole('button', { name: 'Annehmen …' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Veröffentlichen/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Annehmen', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/animals?text=Wilma');
    await expect(page.getByRole('row', { name: /Wilma/ }).getByRole('switch')).toBeChecked();
  });

  test('lehnt einen Vorschlag mit Grund ab', async ({ page }) => {
    await page.goto('/animals/proposals?kind=create');
    await page.getByRole('link', { name: 'Bodo' }).click();
    await page.getByRole('button', { name: 'Ablehnen …' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund').fill('Kein Hund aus unserem Partnertierheim.');
    await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/animals/proposals?state=rejected');
    await expect(page.getByRole('row', { name: /Bodo/ })).toContainText('Kein Hund aus unserem Partnertierheim.');
  });

  test('Stapel: Rückgängig schickt nichts ab, ein Wisch nimmt nach fünf Sekunden an', async ({ page }) => {
    // Gefiltert auf Nala: Baxter läge sonst vorn und leitete auf die Prüfseite um.
    await page.goto('/animals/proposals/review?text=Nala');
    await expect(page.getByRole('button', { name: 'Annehmen', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: /Rückgängig/ }).click();
    // Die 5 s Zurückhalten sind das Verhalten, das hier geprüft wird: Nach Ablauf darf nichts abgeschickt sein.
    await page.waitForTimeout(5_500);
    await page.goto('/animals/proposals?text=Nala');
    await expect(page.getByRole('row', { name: /Nala/ })).toBeVisible();
    await page.goto('/animals/proposals/review?text=Nala');
    // Die Zählung steht sofort da (M3), abgeschickt wird erst nach 5 s. Ein Seitenwechsel vorher verwürfe die
    // zurückgehaltene Entscheidung (gewollt) oder bräche die laufende Server Action ab — darum auf ihre Antwort warten.
    const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Annehmen', exact: true }).click();
    await expect(page.getByText('Alle durchgesehen')).toBeVisible();
    await expect(page.getByText(/1 angenommen/)).toBeVisible();
    await sent;
    await page.goto('/animals/proposals?text=Nala');
    await expect(page.getByText('Keine offenen Vorschläge').or(page.getByText(/passt zu diesen Filtern/))).toBeVisible();
  });

  test('Stapel: Konflikt führt auf die Prüfseite', async ({ page }) => {
    await page.goto('/animals/proposals/review?text=Baxter');
    await expect(page.getByText(/Annehmen geht hier nur über die Prüfseite\./)).toBeVisible();
    await page.getByRole('button', { name: 'Prüfen und dort annehmen' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Änderung an Baxter');
  });

  test('Hinweis „nicht mehr gelistet“: Vermittelt · offline · erledigt in einem Klick', async ({ page }) => {
    await page.goto('/animals/proposals?kind=notice');
    await page.getByRole('link', { name: 'Mika' }).click();
    // Der zugängliche Name ist der sichtbare Text (WCAG 2.5.3), die lange Fassung die Beschreibung.
    const resolve = page.getByRole('button', { name: 'Vermittelt · offline · erledigt', exact: true });
    await expect(resolve).toHaveAccessibleDescription(/Als vermittelt markieren, von der Webseite nehmen/);
    await resolve.click();
    await expect(page.getByRole('button', { name: /Rückgängig/ })).toBeVisible();
    // Zurückgehalten wie im Stapel: erst nach 5 s abgeschickt.
    await page.waitForTimeout(5_500);
    await page.goto('/animals?text=Mika');
    const row = page.getByRole('row', { name: /Mika/ });
    await expect(row).toContainText('Vermittelt');
    await expect(row.getByRole('switch')).not.toBeChecked();
  });
});
