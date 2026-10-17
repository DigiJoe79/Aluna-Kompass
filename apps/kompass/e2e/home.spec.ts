import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';

test.describe('home', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('zeigt nach dem Seed Eingangskorb, Fällig, Einrichtung und Backup', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: 'Guten Tag, Anna.' })).toBeVisible();
    const inbox = page.getByTestId('dashboard-tile-dms-inbox');
    await expect(inbox.getByRole('heading', { name: 'Eingangskorb' })).toBeVisible();
    // Die Kachel zeigt die fünf ältesten Eingänge; welche das sind, verschiebt jeder Seed mit älteren Belegen
    // (F6a: die Spende auf dem § 60a-Bescheid von 2025) — der Test prüft deshalb Form und Weg, keinen Betreff.
    await expect(inbox.getByRole('listitem')).toHaveCount(5);
    await expect(inbox.getByRole('link', { name: /^Alle \d+ anzeigen$/ })).toHaveAttribute('href', '/dms?inbox=1');
    await expect(page.getByTestId('dashboard-tile-core-followUps').getByText('Antwort abwarten')).toBeVisible();
    const setup = page.getByTestId('dashboard-tile-core-setup');
    // Seit 0.2.7 trägt der Seed den ganzen Vereinsstamm, Steuerdaten schreibt der Finanz-Seed über den Bescheid (E22):
    // Die Kachel meldet „eingerichtet“. Den Weg aus einer offenen Zeile prüft der Test an einer Lücke, die er selbst herstellt.
    await expect(setup.getByText('Der Verein ist eingerichtet.')).toBeVisible();
    await expect(page.getByTestId('dashboard-tile-core-backup').getByText(/Noch kein Backup/)).toBeVisible();
    await expect(page.getByTestId('dashboard-tile-core-retention')).toContainText('1');
    await setE2ESetting(page, 'organization.registerCourt', '');
    await page.reload();
    await expect(setup.getByText('Steuernummer fehlt')).toHaveCount(0);
    await setup.getByRole('link', { name: 'Registergericht fehlt' }).click();
    await expect(page).toHaveURL('/admin/settings');
  });

  test('Anpassen: abschalten, in der Spalte umsortieren, Option setzen — hält nach dem Neuladen; Vorgabe stellt zurück', async ({ page }) => {
    await loginAsAdmin(page);
    // Anna darf Finanzen lesen: Vorgabe 2:1, Listen in der breiten Spalte (Briefing § 1).
    await expect(page.getByTestId('dashboard-columns')).toHaveAttribute('data-layout', 'wide-narrow');
    await page.getByRole('button', { name: 'Anpassen' }).click();
    const sheet = page.getByTestId('dashboard-customize');
    // Base UI verdrahtet den Schalter per `aria-labelledby` mit dem sichtbaren
    // Titel; der ist sein Name. Ein eigenes `aria-label` stand hier bis
    // 0.1.1 und wirkte nie (aria-labelledby geht vor).
    await sheet.getByRole('switch', { name: 'Unversandt' }).click();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toHaveCount(0);

    // Den Eingangskorb in seiner Spalte nach oben schieben, bis er dort die erste Kachel ist. Die Pfeile ordnen nur
    // innerhalb der Spalte; eine Schleife hält den Test unabhängig von der Vorgabe-Reihenfolge.
    const column = sheet.getByTestId(/^customize-column-/).filter({ has: page.getByText('Eingangskorb', { exact: true }) });
    let clicks = 0;
    for (let i = 0; i < 10; i++) {
      const rows = column.getByRole('listitem');
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

    // „Spalte“ und die Optionen stehen hinter „Einstellungen“ (Designer 2026-10-17, Frage 3).
    const withPeriod = sheet.getByRole('listitem').filter({ has: page.getByLabel('Zeitraum') });
    await withPeriod.getByText('Einstellungen', { exact: true }).click();
    await withPeriod.getByLabel('Zeitraum').selectOption('30');

    await page.reload();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-column-0').locator('[data-testid^="dashboard-tile-"]').first()).toHaveAttribute('data-testid', 'dashboard-tile-dms-inbox');
    await page.getByRole('button', { name: 'Anpassen' }).click();
    await expect(page.getByTestId('dashboard-customize').getByLabel('Zeitraum')).toHaveValue('30');
    await page.getByTestId('dashboard-customize').getByRole('button', { name: 'Vorgabe wiederherstellen' }).click();
    await expect(page.getByText('Startseite auf die Vorgabe zurückgesetzt')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('dashboard-tile-dms-unsent')).toBeVisible();
    await expect(page.getByTestId('dashboard-column-0').locator('[data-testid^="dashboard-tile-"]').first()).toHaveAttribute('data-testid', 'dashboard-tile-core-followUps');
  });

  test.describe('bei 1440 × 900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    /** Die Kacheln je Spalte der Seite, als Kennungen. */
    const pageColumns = (page: Page) =>
      page.locator('[data-testid^="dashboard-column-"]').evaluateAll((columns) => columns.map((c) => [...c.querySelectorAll('[data-testid^="dashboard-tile-"]')].map((t) => t.getAttribute('data-testid'))));

    test('Layout wechseln und zurück: jedes Layout behält seine Anordnung; eine Kachel in Spalte 3 legen', async ({ page }) => {
      await loginAsAdmin(page);
      const grid = page.getByTestId('dashboard-columns');
      await expect(grid).toHaveAttribute('data-layout', 'wide-narrow');
      await expect(grid).toHaveAttribute('data-columns', '2');
      const wide = await pageColumns(page);

      await page.getByRole('button', { name: 'Anpassen' }).click();
      const sheet = page.getByTestId('dashboard-customize');
      await sheet.getByRole('radio', { name: 'Drei gleiche Spalten' }).click();
      // Ab 1440 px Fenster stehen drei Spalten nebeneinander (Briefing § 1).
      await expect(grid).toHaveAttribute('data-layout', 'thirds');
      await expect(grid).toHaveAttribute('data-columns', '3');
      // Erster Wechsel: Spalte 1 und 2 aus der breiten Spalte, die schmale wird Spalte 3 (Briefing § 5).
      await expect(page.getByTestId('dashboard-column-2').locator('[data-testid^="dashboard-tile-"]')).toHaveCount(wide[1]!.length);

      // Eine Kachel aus Spalte 1 in Spalte 3 legen: Sie steht dort (vor den Ruhe-Zeilen, die die Seite ans Ende stellt).
      const first = sheet.getByTestId('customize-column-0').getByRole('listitem').first();
      const moved = (await first.getAttribute('data-testid'))!.replace('customize-tile-', 'dashboard-tile-');
      await first.getByText('Einstellungen', { exact: true }).click();
      await first.getByLabel('Spalte', { exact: true }).selectOption({ label: 'Spalte 3' });
      await expect.poll(async () => (await pageColumns(page))[2]).toContain(moved);
      expect((await pageColumns(page))[0]).not.toContain(moved);
      const thirds = await pageColumns(page);

      // Zurück auf 2:1: die vorige Anordnung ist wieder da.
      await sheet.getByRole('radio', { name: 'Breit und schmal' }).click();
      await expect(grid).toHaveAttribute('data-layout', 'wide-narrow');
      await expect.poll(() => pageColumns(page)).toEqual(wide);
      // Und wieder auf drei: die Kachel steht noch in Spalte 3.
      await sheet.getByRole('radio', { name: 'Drei gleiche Spalten' }).click();
      await expect(grid).toHaveAttribute('data-layout', 'thirds');
      await expect.poll(() => pageColumns(page)).toEqual(thirds);
      await page.reload();
      await expect.poll(() => pageColumns(page)).toEqual(thirds);
    });

    test('jedes Zahl-Widget ist per Tastatur erreichbar und öffnet mit Enter; kein „Zu …“-Knopf', async ({ page }) => {
      await loginAsAdmin(page);
      await expect(page.getByTestId('dashboard-columns')).toBeVisible();
      await expect(page.getByRole('link', { name: /^Zu(m|r)? / })).toHaveCount(0);
      const retention = page.getByTestId('dashboard-tile-core-retention').getByRole('link');
      await retention.focus();
      await expect(retention).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/admin/retention');
    });
  });

  test('am Telefon: eine Spalte, Warnungen oben, kein waagerechter Überlauf', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAdmin(page);
    const tiles = page.locator('[data-testid^="dashboard-tile-"]');
    await expect(tiles.first()).toBeVisible();
    const tops = await tiles.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid'), tone: e.getAttribute('data-tone'), y: e.getBoundingClientRect().top })));
    const backup = tops.find((t) => t.id === 'dashboard-tile-core-backup')!;
    expect(backup.tone).toBe('warning');
    // Die Warnung „Backup“ steht über jeder Kachel ohne Warnung.
    for (const other of tops.filter((t) => t.tone !== 'warning')) expect(backup.y, other.id!).toBeLessThan(other.y);
    expect(await page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
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
    // F8a Task 7: der Finanz-Seed ergänzt seine gespeicherte Anordnung um „Wartet auf Ihre
    // Freigabe“ — sonst sähe er sie erst nach „Vorgabe wiederherstellen“.
    await expect(page.locator('[data-testid^="dashboard-tile-"]')).toHaveCount(4);
    const grid = page.getByTestId('dashboard-columns');
    const columns = await page.locator('[data-testid^="dashboard-column-"]').evaluateAll((cs) => cs.map((c) => [...c.querySelectorAll('[data-testid^="dashboard-tile-"]')].map((t) => t.getAttribute('data-testid'))));
    // Seine alte flache Liste steht als drei gleiche Spalten (er sieht keine Arbeit-Kachel): Fällig | Unversandt |
    // Backup, Freigabe. Bei 1280 px Fenster ist der Behälter schmaler als 1440 px: zwei Spalten, Spalte 3 abwechselnd
    // an 1 und 2 (Briefing § 1).
    await expect(grid).toHaveAttribute('data-layout', 'thirds');
    await expect(grid).toHaveAttribute('data-columns', '2');
    expect(columns).toEqual([
      ['dashboard-tile-core-followUps', 'dashboard-tile-core-backup'],
      ['dashboard-tile-dms-unsent', 'dashboard-tile-finance-approvalsPending'],
    ]);
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
