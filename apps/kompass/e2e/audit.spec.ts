import { expect, test } from './fixtures';
import { callTool, mcpClient } from './expense-helpers';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('audit log', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  /** Wie Tier-, Kontaktliste und Akte (Befund 2026-09-30): Such- und Datumsfelder lasen die Adresse nur beim ersten Rendern. */
  test('Such- und Datumsfelder folgen der Adresse, auch wenn sie von außen wechselt', async ({ page }) => {
    await page.goto('/admin/audit');
    // Die Suche gilt nach kurzer Pause, ohne Enter (Spec Filterleisten § 4).
    await page.getByRole('searchbox', { name: 'Suchen' }).fill('settings');
    await expect(page).toHaveURL(/text=settings/);
    await page.getByLabel('Von').fill('2026-01-01');
    await expect(page).toHaveURL(/from=2026-01-01/);
    await page.getByRole('navigation', { name: 'Unternavigation' }).getByRole('link', { name: 'Änderungsprotokoll' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole('searchbox', { name: 'Suchen' })).toHaveValue('');
    await expect(page.getByLabel('Von')).toHaveValue('');
  });

  test('lists entries newest first, filters by channel and opens the field diff', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Vereinsname').fill('Geänderter Verein e.V.');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');
    await page.goto('/admin/audit');
    // Erst auf die Oberfläche filtern: Nach dem Reset liest der Hintergrund-
    // dienst die Seed-PDFs und schreibt „Volltext gelesen“ ins Protokoll —
    // womöglich nach der Änderung oben. Neueste zuerst gilt trotzdem, nur ist
    // die oberste Zeile ohne Filter nicht zwingend die eigene.
    // Kanal steht unter „Weitere Filter“ (Spec Filterleisten § 4).
    await page.getByRole('button', { name: 'Weitere Filter' }).click();
    await page.getByLabel('Kanal', { exact: true }).selectOption('ui');
    const rows = page.getByRole('table').getByRole('row');
    // Die Aktion in Worten (Spec Protokoll § 4), nicht als Schlüssel.
    await expect(rows.nth(1)).toContainText('Einstellung');
    await expect(rows.nth(1)).not.toContainText('settings.update');
    await expect(rows.nth(1)).toContainText('Oberfläche');
    await page.getByLabel('Kanal', { exact: true }).selectOption('system');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('System');
    await page.getByLabel('Kanal', { exact: true }).selectOption('ui');
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Einstellung');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Weitere Filter\s*1$/ })).toBeVisible();
    await rows.nth(1).click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('heading', { name: 'Einstellung geändert' })).toBeVisible();
    // Was geschah: der Satz mit dem Schlüssel der Einstellung (Spec Protokoll § 4).
    await expect(detail).toContainText('Was geschah');
    await expect(detail).toContainText('Einstellung „Vereinsname“ geändert');
    // Die technische Aktion steht am Ende, mit Kopieren (Designer 2026-10-09).
    await expect(detail).toContainText('Aktion (technisch)');
    await expect(detail).toContainText('settings.update');
    await expect(detail.getByRole('button', { name: 'Kopieren: Aktion (technisch)' })).toBeVisible();
    await expect(detail.getByText('Musterverein e.V.')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(detail.getByText('Geänderter Verein e.V.')).toBeVisible();
    await expect(detail).toContainText('Einträge können nicht geändert werden.');
  });

  /** Spec Filterleisten § 4, Review Focus 4: „Aktion“ in Worten, das Protokoll blättert mit ListPager. */
  test('die Aktion steht in Worten, die Zählzeile zählt, das Protokoll blättert', async ({ page }) => {
    await page.goto('/admin/audit');
    const action = page.getByLabel('Aktion', { exact: true });
    await expect(action.locator('option').first()).toHaveText('Aktion: alle');
    await expect(action.locator('option', { hasText: 'Kontakt angelegt' })).toHaveCount(1);
    await expect(action.locator('option', { hasText: 'contacts.create' })).toHaveCount(0);
    await expect(page.getByText(/^\d+ Einträge$/)).toBeVisible();
    await expect(page.getByTestId('audit-pager')).toContainText(/^1–50 von \d+/);

    await action.selectOption({ label: 'Kontakt angelegt' });
    await expect(page).toHaveURL(/action=contacts\.create/);
    await expect(page.getByText(/^\d+ von \d+ Einträgen$/)).toBeVisible();
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
  });

  test('D7: eine Kontaktänderung zeigt die geänderten Felder mit Beschriftung, keinen Scheinwert', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Vorher e.V.' });
    await callTool(client, 'contacts_update', { id: org.id, name: 'Nachher e.V.' });
    const { entries } = await callTool<{ entries: { id: string; entityId: string; params: Record<string, unknown> | null }[] }>(client, 'audit_query', { entityType: 'contact', action: 'contacts.update', entityId: org.id });
    const entry = entries[0]!;
    expect(entry.params).toEqual({ scope: 'name' });

    await page.goto(`/admin/audit?entry=${entry.id}`);
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText('Geänderte Felder: Name');
    await expect(detail).toContainText('Name des Kontakts geändert');
    await expect(detail).toContainText('Bei Kontakten protokolliert Kompass keine Werte, nur die geänderten Felder.');
    await expect(detail).not.toContainText('nachher');
    await expect(detail).not.toContainText('["name"]');
  });

  test('requires audit.view', async ({ page }) => {
    // Schriftführung (documents.export) hat kein audit.view
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
    await page.goto('/admin/audit');
    await expect(page.getByText('audit.view')).toBeVisible();
  });

  /** Review Focus 1 (Plan Protokoll): Einträge von vor Migration 0006 haben keine Werte. */
  test('ein alter Eintrag ohne Werte zeigt den Klartext, das Detail hat kein „Was geschah“', async ({ page }) => {
    const response = await page.request.post('/__e2e/audit-legacy', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { action: 'roles.update', entityType: 'role', entityId: 'LEGACY-1' } });
    expect(response.ok()).toBe(true);
    const { id } = (await response.json()) as { id: string };
    await page.goto('/admin/audit?action=roles.update');
    // Die Rolle gibt es nicht: Die Spalte „Objekt“ sagt das in Worten, die ID steht nur im Detail (Joe 2026-10-09).
    const row = page.getByRole('table').getByRole('row').filter({ hasText: 'Rolle · gelöscht' });
    await expect(row).toContainText('Rolle geändert');
    await expect(row).not.toContainText('LEGACY-1');
    // „gelöscht“ gedämpft an der Stelle des Namens, damit es nicht wie ein Name aussieht (Designer 2026-10-09).
    await expect(row.getByText('gelöscht', { exact: true })).toHaveClass(/text-muted-ink/);
    await page.goto(`/admin/audit?action=roles.update&entry=${id}`);
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('heading', { name: 'Rolle geändert' })).toBeVisible();
    await expect(detail).toContainText('Aktion (technisch)');
    await expect(detail).not.toContainText('Was geschah');
    await expect(detail).toContainText('role · LEGACY-1');
  });

  /** Joe 2026-10-09: Die Spalte „Objekt“ nennt den Typ in Worten und den Namen — nie den Schlüssel, nie die ID. */
  test('die Spalte „Objekt“ zeigt Typ und Namen, die ID steht im Detail', async ({ page }) => {
    await page.goto('/admin/audit?action=setup.complete');
    const row = page.getByRole('table').getByRole('row').filter({ hasText: 'Nutzer · Anna Berger' });
    await expect(row.getByRole('cell').last()).toHaveText('Nutzer · Anna Berger');
    await row.getByRole('link').click();
    const detail = page.getByRole('dialog');
    await expect(detail).toContainText('Nutzer · Anna Berger');
    await expect(detail).toContainText(/user · [0-9A-HJKMNP-TV-Z]{26}/);
    await expect(detail.getByRole('button', { name: 'Kopieren: Objekt (technisch)' })).toBeVisible();
  });

  /** Spec Protokoll § 4: Die Suche läuft über das Gespeicherte; Personen findet man über den Filter „Nutzer“. */
  test('eine Suche ohne Treffer und ohne Nutzer-Filter verweist auf den Filter „Nutzer“', async ({ page }) => {
    await page.goto('/admin/audit?text=Wortgibtesnichtimprotokoll');
    await expect(page.getByText('Personen finden Sie über den Filter „Nutzer“.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Filter zurücksetzen' }).first()).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Suchen' })).toHaveAttribute('placeholder', 'Nummer, Bezeichnung, ID');
  });
});
