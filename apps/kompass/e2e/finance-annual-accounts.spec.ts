import { expect, test } from './fixtures';
import { ADMIN, loginAs, loginAsAdmin, openFiscalYear, resetDatabase } from './helpers';
import { STORY_YEAR } from './story-year';

/**
 * Jahresrechnung (Plan U1): der Weg nach dem Festschreiben an der Karte „Webseite“ — Erläuterung, Festschreiben, Bitte um
 * Abzeichnung, Abzeichnung über das eigene Konto, Bereitstellen und von der Webseite nehmen. Seed: Das mittlere
 * abgeschlossene Jahr hat eine Erläuterung, einen festgeschriebenen Kassenbericht und ein MV-Ergebnis, aber keine
 * festgeschriebene Jahresrechnung; Thomas Wendt vertritt den Verein und hat ein Konto (J2).
 */
const YEAR = STORY_YEAR - 2;
const THOMAS = { email: 'thomas@kompass.local', password: ADMIN.password };

test.describe.serial('finance annual accounts (U1)', () => {
  let yearId = '';
  const open = async (page: import('@playwright/test').Page) => {
    await page.goto(`/finance/reports/annualAccounts?year=${yearId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Jahresrechnung ${YEAR}`);
  };
  const row = (page: import('@playwright/test').Page, key: 'explanation' | 'signature' | 'website') => page.getByTestId('annual-accounts-card').getByTestId(`requirement-${key}`);

  test('Erläuterung, Festschreiben, Bitte, Abzeichnung über das eigene Konto', async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    yearId = await openFiscalYear(page, '/finance/reports', YEAR);
    await open(page);

    // Erläuterung (Seed: schon geschrieben) bearbeiten und speichern.
    await row(page, 'explanation').getByRole('button', { name: 'Bearbeiten …' }).click();
    const explanation = page.getByRole('dialog');
    await explanation.getByRole('textbox').fill('Ein ruhiges Jahr mit treuen Spenderinnen und Spendern.');
    await explanation.getByRole('button', { name: 'Speichern' }).click();
    await expect(explanation).toBeHidden();
    await expect(row(page, 'explanation')).toContainText('54 Zeichen');
    await expect(row(page, 'signature')).toContainText('nach dem Festschreiben');

    // Festschreiben: mit Erläuterung keine Folge „ohne Erläuterung“.
    await page.getByTestId('report-finalize').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Die Jahresrechnung erscheint ohne Erläuterung.')).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Festschreiben' }).click();
    await expect(page.locator('[data-slot="page-header-title"]')).toContainText('festgeschrieben');
    await expect(row(page, 'signature')).toContainText('Noch nicht abgezeichnet.');

    // Um Abzeichnung bitten — an Thomas Wendt.
    await row(page, 'signature').getByRole('button', { name: 'Um Abzeichnung bitten …' }).click();
    const request = page.getByRole('dialog');
    await request.getByRole('combobox', { name: /Zuständig/ }).selectOption({ label: 'Thomas Wendt' });
    await request.getByRole('button', { name: 'Wiedervorlage anlegen' }).click();
    await expect(request).toBeHidden();
    await expect(row(page, 'signature')).toContainText('Thomas Wendt gebeten am');

    // Thomas findet die Bitte unter „Fällig“, der Bezug führt auf die Jahresrechnung.
    await loginAs(page, THOMAS.email, THOMAS.password);
    const tile = page.getByTestId('dashboard-tile-core-followUps');
    const item = tile.getByRole('listitem').filter({ hasText: `Jahresrechnung ${YEAR} abzeichnen` });
    await expect(item).toBeVisible();
    await item.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/finance/reports/annualAccounts\\?year=${yearId}`));

    await row(page, 'signature').getByRole('button', { name: 'Abzeichnen …' }).click();
    const sign = page.getByRole('dialog');
    await expect(sign.getByRole('textbox')).toHaveCount(0);
    await sign.getByRole('button', { name: 'Abzeichnen', exact: true }).click();
    await expect(sign).toBeHidden();
    // Seit seiner Wiederwahl im Stichjahr (Gremien-Seed) trägt seine Rolle den Namen des Amts, davor den Vermerk der
    // Rolle von vor Kompass — gezeichnet wird heute, also mit dem Amt.
    await expect(row(page, 'signature')).toContainText(/Thomas Wendt, Stellvertretender Vorsitz(ender)?, am/);

    await page.goto('/');
    await expect(tile.getByText(`Jahresrechnung ${YEAR} abzeichnen`)).toHaveCount(0);
  });

  test('Publizieren nach der Mitgliederversammlung ist ein Klick, die Bereitstellung zurücknehmen fragt', async ({ page }) => {
    await loginAsAdmin(page);
    await open(page);
    await expect(row(page, 'website')).toContainText('nicht publiziert');
    await row(page, 'website').getByRole('button', { name: 'Auf der Webseite publizieren' }).click();
    // Nach dem MV-Ergebnis kein Dialog: bereitgestellt, sichtbar erst mit dem nächsten Publizieren der Webseite.
    await expect(row(page, 'website')).toContainText('Bereitgestellt am');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, 'website').getByRole('link', { name: 'Zur Webseite' })).toHaveAttribute('href', '/site/publish');

    await row(page, 'website').getByRole('button', { name: /^Aktionen für/ }).click();
    // Nur bereitgestellt, nie auf der Webseite: „Bereitstellung zurücknehmen“ (Abnahme B1, Nachzug 3).
    await page.getByRole('menuitem', { name: 'Bereitstellung zurücknehmen …' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Bereitstellung zurücknehmen' }).click();
    await expect(confirm).toBeHidden();
    await expect(row(page, 'website')).toContainText('nicht publiziert');
    await expect(row(page, 'website').getByRole('button', { name: 'Auf der Webseite publizieren' })).toBeVisible();
  });
});
