import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows one rail row per area, home on top and settings behind a line', async ({ page }) => {
    await expect(page.getByTestId('env-banner')).toContainText('TESTUMGEBUNG');
    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link')).toHaveText(['Startseite', 'Webseite', 'Projekte', 'Tiere', 'Kontakte', 'Akte', 'Mediathek', 'Einstellungen']);
    // Seiten stehen nicht in der Schiene — weder aus Verwaltung noch aus einem Modul.
    await expect(rail.getByRole('link', { name: 'Nutzer' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Hunde' })).toHaveCount(0);
    await expect(rail).toHaveCSS('width', '88px');
    // Auf der Startseite gibt es keine Zweitebene.
    await expect(page.getByRole('navigation', { name: 'Unternavigation' })).toHaveCount(0);
  });

  test('puts organisation, user menu and build into the top bar', async ({ page }) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByText('Musterverein e.V.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('Musterverein e.V.')).toHaveCount(0);
    await banner.getByRole('button', { name: 'Nutzermenü' }).click();
    await expect(page.getByRole('menu').getByText(/^Build /)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('marks the area in the rail and shows no second level while the area has a single page', async ({ page }) => {
    await page.goto('/animals');
    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link', { name: 'Tiere' })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: 'Startseite' })).not.toHaveAttribute('aria-current', 'page');
    // Tiere hat heute eine Seite; eine Spalte mit „Hunde“ unter „Tiere“ würde
    // nur die Schiene wiederholen. Sie erscheint, sobald das Modul wächst.
    await expect(page.getByRole('navigation', { name: 'Unternavigation' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hunde');
  });

  test('keeps the module marked under a website collection', async ({ page }) => {
    // Sammlungen gibt es erst mit eingelesenem Template — derselbe Weg wie in
    // `site-template.spec.ts`; das Basis-Template bringt die Sammlung „Aktuelles“ mit.
    await page.goto('/site/template');
    await page.getByRole('button', { name: 'Template einlesen' }).click();
    await expect(page.getByRole('region', { name: 'Befunde' })).toBeVisible();
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('status')).toContainText('eingelesen');

    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await sections.getByRole('link', { name: 'Aktuelles' }).click();
    await expect(page).toHaveURL('/site/c/news');
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Webseite' })).toHaveAttribute('aria-current', 'page');
    await expect(sections.getByRole('link', { name: 'Aktuelles' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aktuelles');
    await expect(page.getByRole('banner')).toContainText('Webseite');
  });

  test('opens settings as one area with two headed sections', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).click();
    await expect(page).toHaveURL('/admin/users');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections.getByText('Verwaltung')).toBeVisible();
    await expect(sections.getByText('Einrichtung')).toBeVisible();
    for (const label of ['Nutzer', 'Rollen', 'Änderungsprotokoll', 'Aufbewahrung', 'Backup', 'Stammdaten', 'Sprachen', 'Erscheinungsbild', 'Module', 'Dokumentvorlagen', 'Akte einrichten']) {
      await expect(sections.getByRole('link', { name: label })).toBeVisible();
    }
    // Die Mediathek ist ein eigener Bereich in der Schiene, kein Verwaltungspunkt.
    await expect(sections.getByRole('link', { name: 'Mediathek' })).toHaveCount(0);
    await expect(sections).toHaveCSS('width', '208px');
    await sections.getByRole('link', { name: 'Erscheinungsbild' }).click();
    await expect(sections.getByRole('link', { name: 'Erscheinungsbild' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('banner')).toContainText('Einstellungen');
    await expect(page.getByRole('banner')).toContainText('Einrichtung');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Erscheinungsbild');
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('aria-current', 'page');
  });

  test('the command palette still finds pages of modules and settings', async ({ page }) => {
    await expect(page.locator('body[data-command-palette="ready"]')).toBeAttached();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await palette.getByRole('combobox').fill('Hunde');
    await expect(palette.getByRole('option', { name: /Hunde/ })).toBeVisible();
    await palette.getByRole('combobox').fill('Erscheinungsbild');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/themes');
  });

  test('switches colour scheme from the user menu and logs out', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL('/login');
  });

  /**
   * Die Dichte war doppelt gebrochen: Das Theme setzt `--row-h` ungelayert,
   * die Dichteregeln standen in `@layer base` und verloren damit jede
   * Kaskade — und der Bootstrap schrieb den JSON-Wert mitsamt
   * Anführungszeichen ins Attribut, sodass nach dem Neuladen ohnehin keine
   * Regel mehr traf. Gemessen wird deshalb beides: die Variable und die
   * Höhe, die tatsächlich auf dem Schirm steht, vor und nach dem Neuladen.
   *
   * Die Höhe wird in der Akte gemessen und nicht in der Nutzerliste. Dort
   * tragen die Rollen-Marken die Zeile von sich aus auf 55px, und `height`
   * ist auf einem `tr` nur eine Mindesthöhe — „kompakt“ bliebe unsichtbar.
   * Das ist ein eigener Mangel (das Zellpolster hängt nicht an der Dichte)
   * und nicht der, den dieser Test hütet.
   */
  test('applies the row density from the user menu and keeps it across a reload', async ({ page }) => {
    await page.goto('/dms');
    const rowHeight = () => page.locator('tbody tr').first().evaluate((el) => el.getBoundingClientRect().height);
    const variable = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return style.getPropertyValue('--row-h-density').trim() || style.getPropertyValue('--row-h').trim();
      });
    const setDensity = async (label: string) => {
      await page.getByRole('button', { name: 'Nutzermenü' }).click();
      await page.getByRole('menuitemradio', { name: label }).click();
      await page.keyboard.press('Escape');
    };

    // Ohne eigene Wahl gilt der Wert aus dem Theme.
    expect(await variable()).toBe('44px');
    expect(await rowHeight()).toBe(44);

    await setDensity('Kompakte Zeilen');
    expect(await variable()).toBe('36px');
    expect(await rowHeight()).toBeLessThan(44);

    // Und der Wert übersteht das Neuladen — daran scheiterte er bisher.
    await page.goto('/dms');
    expect(await variable()).toBe('36px');
    expect(await rowHeight()).toBeLessThan(44);

    await setDensity('Komfortable Zeilen');
    expect(await variable()).toBe('56px');
    expect(await rowHeight()).toBe(56);

    // „Normal“ setzt bewusst nichts, damit das Theme wieder die Vorgabe wird.
    await setDensity('Normale Zeilen');
    expect(await variable()).toBe('44px');
    expect(await rowHeight()).toBe(44);
  });

  /**
   * Derselbe Bootstrap-Fehler nahm den Dunkelmodus mit: gewählt blieb er nur
   * bis zum nächsten Seitenaufruf. Der Test oben prüft das Umschalten, dieser
   * das Bleiben.
   */
  test('keeps the dark colour scheme across a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');

    await page.goto('/admin/users');
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    // Und das Menü zeigt danach immer noch das Häkchen.
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' })).toBeChecked();
    await page.keyboard.press('Escape');
  });

  test('turns into a drawer below 1180px with labelled areas and the second level beneath', async ({ page }) => {
    await page.goto('/admin/themes');
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Tiere' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Unternavigation' }).getByRole('link', { name: 'Erscheinungsbild' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a user without module rights sees neither the modules nor an admin page she may not open', async ({ page }) => {
    // Kassenprüfer ist eine Seed-Rolle ohne Modulrecht: audit.view und
    // documents.export (roles.spec.ts, Test „edits permissions …“, zeigt den
    // Stand). Beides sind Kernrechte, keine Modulrechte, also bleibt die
    // Schiene bei Startseite und Einstellungen.
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kassenprüfer').check();
    await dialog.getByLabel('Name').fill('Lea Prüfer');
    await dialog.getByLabel('E-Mail').fill('lea@example.org');
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');

    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('lea@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL('/password');
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('lea-prueft-die-kasse-2026');
    await page.getByLabel('Passwort wiederholen').fill('lea-prueft-die-kasse-2026');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link')).toHaveText(['Startseite', 'Einstellungen']);
    await expect(rail.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '/admin/audit');
    await rail.getByRole('link', { name: 'Einstellungen' }).click();
    await expect(page).toHaveURL('/admin/audit');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections.getByText('Verwaltung')).toBeVisible();
    await expect(sections.getByText('Einrichtung')).toBeVisible();
    await expect(sections.getByRole('link')).toHaveText(['Änderungsprotokoll', 'Dokumentvorlagen']);
  });
});
