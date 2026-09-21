import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('finance', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('das Journal zeigt die Buchungen des Seeds mit Zustand als Wort', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(page.getByRole('row', { name: /festgeschrieben/ }).first()).toBeVisible();
  });

  test('der Zustandsfilter zeigt nur Entwürfe und überlebt das Sortieren', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.getByLabel('Zustand').selectOption('draft');
    await expect(page).toHaveURL(/state=draft/);
    await expect(page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' })).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Entwurf geprüft' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sortieren nach Datum' }).click();
    await expect(page).toHaveURL(/state=draft/);
    await expect(page).toHaveURL(/sort=entryDate/);
  });

  test('die Summenzeile nennt die gefilterte Menge', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await expect(page.getByText(/Summe über die gefilterten \d+ Buchungen/)).toBeVisible();
  });

  test('eine zurückgenommene Buchung ist mit ihrer Gegenbuchung verlinkt', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    const row = page.locator('tr', { hasText: 'Fehlerhafte Spendenbuchung' });
    await expect(row.getByRole('link', { name: /zurückgenommen durch/ })).toBeVisible();
  });

  test('Mehrfachauswahl: zwei Entwürfe als geprüft markieren, dann festschreiben; die Nummern erscheinen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    const rowA = page.locator('tr', { hasText: 'Entwurf ungeprüft' }).filter({ hasNotText: 'zwei' });
    const rowB = page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' });
    await rowA.getByRole('checkbox').click();
    await rowB.getByRole('checkbox').click();
    await expect(page.getByText('2 Buchungen ausgewählt')).toBeVisible();
    await page.getByRole('button', { name: 'als geprüft markieren' }).click();
    await expect(page.getByText('Als geprüft markiert.')).toBeVisible();

    const rowA2 = page.locator('tr', { hasText: 'Entwurf ungeprüft' }).filter({ hasNotText: 'zwei' });
    const rowB2 = page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' });
    await rowA2.getByRole('checkbox').click();
    await rowB2.getByRole('checkbox').click();
    await page.getByRole('toolbar').getByRole('button', { name: 'festschreiben' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'festschreiben' }).click();
    await expect(page.getByText(/Festgeschrieben: /)).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Entwurf ungeprüft zwei' }).getByRole('cell').nth(1)).toContainText(/\d{4}-\d+/);
  });

  test('ohne finance.read steht die ForbiddenCard', async ({ page }) => {
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
    await page.goto('/finance/entries');
    await expect(page.getByText('finance.read')).toBeVisible();
  });

  test('die Randspalte merkt sich die ausdrückliche Wahl', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/entries');
    await page.getByRole('button', { name: 'Ausklappen' }).click();
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('kompass.financeSidePanel'));
    expect(stored).toBe('"open"');
    await page.reload();
    await expect(page.getByTestId('finance-side-panel')).toBeVisible();
  });
});
