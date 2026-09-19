import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('home', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('zeigt nach dem Seed Eingangskorb, Fällig, Einrichtung und Backup', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: 'Guten Tag, Anna.' })).toBeVisible();
    const inbox = page.getByTestId('dashboard-tile-dms-inbox');
    await expect(inbox.getByRole('heading', { name: 'Eingangskorb' })).toBeVisible();
    await expect(inbox.getByRole('link', { name: 'Freistellungsbescheid' })).toBeVisible();
    await expect(page.getByTestId('dashboard-tile-core-followUps').getByText('Antwort abwarten')).toBeVisible();
    const setup = page.getByTestId('dashboard-tile-core-setup');
    await expect(setup.getByText('Steuernummer fehlt')).toBeVisible();
    await expect(page.getByTestId('dashboard-tile-core-backup').getByText(/Noch kein Backup/)).toBeVisible();
    await expect(page.getByTestId('dashboard-tile-core-retention')).toContainText('1');
    await setup.getByRole('link', { name: 'Steuernummer fehlt' }).click();
    await expect(page).toHaveURL('/admin/settings');
  });

  test('Anpassen: abschalten, umsortieren, Option setzen — hält nach dem Neuladen; Vorgabe stellt zurück', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: 'Anpassen' }).click();
    const sheet = page.getByTestId('dashboard-customize');
    // Base UI verdrahtet den Schalter per `aria-labelledby` mit dem sichtbaren
    // Titel; der ist sein Name. Ein eigenes `aria-label` stand hier bis
    // 0.1.1 und wirkte nie (aria-labelledby geht vor).
    await sheet.getByRole('switch', { name: 'Unversandt' }).click();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toHaveCount(0);

    // Den Eingangskorb nach oben schieben, bis er die erste Kachel ist. Die
    // Zahl der nötigen Klicks hängt von der Vorgabe-Reihenfolge ab (Kern vor
    // Site vor Akte); eine Schleife hält den Test unabhängig davon richtig.
    let clicks = 0;
    for (let i = 0; i < 10; i++) {
      const rows = sheet.getByRole('listitem');
      const count = await rows.count();
      let index = -1;
      for (let j = 0; j < count; j++) {
        if ((await rows.nth(j).innerText()).includes('Eingangskorb')) {
          index = j;
          break;
        }
      }
      if (index <= 0) break;
      await rows.nth(index).getByRole('button', { name: 'Nach oben' }).click();
      await expect(rows.nth(index - 1)).toContainText('Eingangskorb');
      clicks++;
    }
    expect(clicks).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[home.spec] Eingangskorb brauchte ${clicks} Klicks „Nach oben“.`);

    await sheet.getByLabel('Zeitraum').selectOption('30');

    await page.reload();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toHaveCount(0);
    const first = page.locator('[data-testid^="dashboard-tile-"]').first();
    await expect(first).toHaveAttribute('data-testid', 'dashboard-tile-dms-inbox');
    await page.getByRole('button', { name: 'Anpassen' }).click();
    await expect(page.getByTestId('dashboard-customize').getByLabel('Zeitraum')).toHaveValue('30');
    await page.getByTestId('dashboard-customize').getByRole('button', { name: 'Vorgabe wiederherstellen' }).click();
    await expect(page.getByText('Startseite auf die Vorgabe zurückgesetzt')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toBeVisible();
    await expect(page.locator('[data-testid^="dashboard-tile-"]').first()).toHaveAttribute('data-testid', 'dashboard-tile-core-followUps');
  });

  test('Jonas Feld sieht seine gespeicherte Anordnung und keinen Link ins Leere', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Jonas Feld/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('jonas@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('jonas-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('jonas-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    // `evaluateAll` wartet nicht: Die URL steht, bevor der Seiteninhalt nachgeliefert ist.
    await expect(page.locator('[data-testid^="dashboard-tile-"]')).toHaveCount(3);
    const ids = await page.locator('[data-testid^="dashboard-tile-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids).toEqual(['dashboard-tile-core-followUps', 'dashboard-tile-dms-unsent', 'dashboard-tile-core-backup']);
    await expect(page.getByTestId('dashboard-tile-core-setup')).toHaveCount(0);
    // Jeder Link der Startseite führt auf eine Seite, die Jonas sehen darf.
    const hrefs = await page.locator('[data-testid^="dashboard-tile-"] a[href]').evaluateAll((els) => els.map((a) => a.getAttribute('href')!));
    for (const href of new Set(hrefs)) {
      await page.goto(href);
      await expect(page.getByText('Kein Recht')).toHaveCount(0);
      await page.goto('/');
    }
  });

  test('Peter Lang ohne Kachelrechte sieht den Hinweis statt Kacheln', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await page.getByRole('row', { name: /Peter Lang/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('peter@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('peter-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('peter-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Keine Kacheln eingeschaltet.')).toBeVisible();
  });
});
