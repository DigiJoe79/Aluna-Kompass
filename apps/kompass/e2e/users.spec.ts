import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('users', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
    await page.goto('/admin/users');
  });

  test('lists seeded users with roles and status', async ({ page }) => {
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(5); // Kopf + 4
    const jonas = table.getByRole('row', { name: /Jonas Feld/ });
    await expect(jonas).toContainText('Schatzmeisterin');
    await expect(jonas).toContainText('Aktiv');
    await expect(page.getByText('4 Nutzer, davon 0 inaktiv')).toBeVisible();
  });

  test('creates a user, shows the start password once and marks first login pending', async ({ page, context }) => {
    // navigator.clipboard braucht einen sicheren Kontext (https oder
    // localhost) -- e2e läuft über localhost und nimmt damit denselben Weg
    // wie eine echte https-Installation, nicht den Fallback fürs LAN-http.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Rita Sommer');
    await dialog.getByLabel('E-Mail').fill('rita@example.org');
    await dialog.getByLabel('Kassenprüfer').check();
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await expect(page.getByRole('dialog', { name: /Nutzer „Rita Sommer“ angelegt/ })).toBeVisible();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await expect(page.getByTestId('start-password')).toHaveText(/^[a-z]+-[a-z]+-\d{2}-[a-z]+$/);
    await page.getByRole('button', { name: 'Beides kopieren' }).click();
    await expect(page.getByRole('button', { name: 'Kopiert' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(startPassword);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Schließen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    const row = page.getByRole('row', { name: /Rita Sommer/ });
    await expect(row).toContainText('Erstlogin offen');
    await expect(row).toContainText('Kassenprüfer');
  });

  test('verknüpft ein Konto mit einem Kontakt und löst die Verknüpfung wieder', async ({ page }) => {
    // Peter Lang ist im Seed schon verknüpft, Mira Klein nicht.
    await expect(page.getByRole('row', { name: /Peter Lang/ }).getByRole('link', { name: 'Peter Lang' })).toBeVisible();
    const row = page.getByRole('row', { name: /Mira Klein/ });
    await expect(row).toContainText('nicht verknüpft');
    await row.getByRole('button', { name: 'Verknüpfen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Kontakt wählen' }).click();
    const option = page.getByTestId('contact-option').filter({ hasText: 'Tomas Leitner' });
    await expect(option).toBeVisible();
    await option.click();
    await dialog.getByRole('button', { name: 'Verknüpfen' }).click();
    await expect(page.getByRole('row', { name: /Mira Klein/ }).getByRole('link', { name: 'Tomas Leitner' })).toBeVisible();
    await page.getByRole('row', { name: /Mira Klein/ }).getByRole('button', { name: 'Lösen' }).click();
    await expect(page.getByRole('row', { name: /Mira Klein/ })).toContainText('nicht verknüpft');
  });

  test('rejects a duplicate e-mail inside the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Doppelt');
    await dialog.getByLabel('E-Mail').fill('jonas@kompass.local');
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await expect(dialog.getByRole('alert')).toContainText('bereits vergeben');
  });

  test('deactivates a user after confirmation and refuses for the last administrator', async ({ page }) => {
    await page.getByRole('row', { name: /Jonas Feld/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Jonas Feld kann sich danach nicht mehr anmelden.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('row', { name: /Jonas Feld/ })).toContainText('Inaktiv');

    await page.getByRole('row', { name: /Anna Berger/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Deaktivieren' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deaktivieren' }).click();
    await expect(page.getByRole('status')).toContainText('Mindestens ein aktiver Nutzer muss die Rolle „Administration“ behalten.');
  });

  test('is forbidden for a role without users.manage', async ({ page }) => {
    // Mira Klein (Kassenprüfer) hat nur audit.view; Startpasswort per Reset holen.
    await page.getByRole('row', { name: /Mira Klein/ }).getByRole('button', { name: 'Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('mira@kompass.local');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('mira-hat-ein-neues-passwort');
    await page.getByLabel('Passwort wiederholen').fill('mira-hat-ein-neues-passwort');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/admin/users');
    await expect(page.getByText('403', { exact: true })).toBeVisible();
    await expect(page.getByText('users.manage')).toBeVisible();
  });

  test('wer nur die Zugänge macht, sieht gesperrt, was über die eigenen Rechte hinausgeht', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'Rolle anlegen' }).click();
    await page.getByRole('dialog').getByLabel('Rollenname').fill('Zugänge');
    await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
    await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Zugänge/ }).click();
    await page.getByRole('checkbox', { name: 'Nutzer verwalten' }).check();
    await page.getByRole('checkbox', { name: 'Rollen verwalten' }).check();
    await page.getByRole('button', { name: 'Rolle speichern' }).click();
    await expect(page.getByRole('status')).toContainText('Rolle gespeichert.');

    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Name').fill('Ute Tor');
    await create.getByLabel('E-Mail').fill('ute@example.org');
    await create.getByLabel('Zugänge').check();
    await create.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();

    await page.request.post('/logout');
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('ute@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('ute-macht-die-zugaenge');
    await page.getByLabel('Passwort wiederholen').fill('ute-macht-die-zugaenge');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    await expect(page.getByRole('dialog').getByLabel('Administration')).toBeDisabled();
    await expect(page.getByRole('dialog').getByLabel('Zugänge')).toBeEnabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();

    await page.getByRole('row', { name: /Anna Berger/ }).getByRole('button', { name: 'Aktionen' }).click();
    await expect(page.getByRole('menuitem', { name: 'Neues Startpasswort' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.goto('/admin/roles');
    await page.getByRole('list', { name: 'Rollen' }).getByRole('button', { name: /Kassenprüfer/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Nutzer verwalten' })).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: 'Einstellungen verwalten' })).toBeDisabled();
    // Was die Rolle schon hat, darf auch entfernt werden, wer es selbst nicht hat.
    await expect(page.getByRole('checkbox', { name: 'Änderungsprotokoll einsehen' })).toBeEnabled();
  });
});
