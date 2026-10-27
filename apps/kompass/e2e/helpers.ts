import { expect, type Locator, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@kompass.local', password: 'kompass-entwicklung-2026' };

export async function resetDatabase(page: Page, mode: 'empty' | 'seeded'): Promise<void> {
  const response = await page.request.post(`/__e2e/reset?mode=${mode}`, { headers: { 'x-e2e-token': 'e2e-reset' } });
  expect(response.ok()).toBe(true);
}

/**
 * Schaltet den Test-Transport des Servers (`KOMPASS_MAIL_FAKE=1`): „nicht eingerichtet“ (Vorgabe nach jedem Zurücksetzen),
 * Testumgebung mit Umleitung an umleitung@example.org, oder gesperrt. Nie eine echte Verbindung.
 */
/**
 * Ein Geschäftsjahr auf Jahresabschluss oder Berichte über `?year=` öffnen, statt der Vorgabe der Seite zu trauen: Die
 * nimmt das jüngste beendete Jahr, das nicht fertig ist — bis Silvester das Vorjahr des Stichjahrs, nach Neujahr das
 * Stichjahr selbst (Befund 0.4.0/32 b, `scripts/e2e-kalender.sh`). Gibt die ID des Jahres zurück.
 */
export async function openFiscalYear(page: Page, path: '/finance/closing' | '/finance/reports', designation: number): Promise<string> {
  await page.goto(path);
  const select = path === '/finance/closing' ? page.getByTestId('closing-year').getByRole('combobox', { name: 'Jahr' }) : page.getByTestId('reports-year').getByRole('combobox', { name: 'Geschäftsjahr' });
  const id = await select.locator('option').filter({ hasText: new RegExp(`^${designation}$`) }).getAttribute('value');
  expect(id).toBeTruthy();
  await page.goto(`${path}?year=${id}`);
  await expect(select).toHaveValue(id!);
  return id!;
}

export async function setMailState(page: Page, state: 'off' | 'redirect' | 'blocked'): Promise<void> {
  const response = await page.request.post('/__e2e/mail', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { state } });
  expect(response.ok()).toBe(true);
}

/**
 * Meldet über `/__e2e/login` an (derselbe Kern-`login`, ohne Maske) und öffnet die Startseite. Die Maske kostete je
 * Fall rund eine Sekunde; sie selbst prüft `auth.spec.ts`. Das Cookie landet im Kontext der Seite.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const response = await page.request.post('/__e2e/login', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { email, password } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL('/');
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, ADMIN.email, ADMIN.password);
}

export async function setE2ESetting(page: Page, key: string, value: unknown): Promise<void> {
  const response = await page.request.post('/__e2e/setting', {
    headers: { 'x-e2e-token': 'e2e-reset' },
    data: { key, value },
  });
  expect(response.ok()).toBe(true);
}

/**
 * Einen datierten Wert des Finanzmoduls ab `validFrom` setzen (`value`) oder die Überschreibung wieder nehmen
 * (`value: undefined`) — etwa `vatEntrepreneur`, das die Steuerfelder beim Buchen zeigt (E6a).
 */
export async function setE2EDatedValue(page: Page, key: string, validFrom: string, value?: unknown): Promise<void> {
  const response = await page.request.fetch('/__e2e/dated-value', {
    method: value === undefined ? 'DELETE' : 'POST',
    headers: { 'x-e2e-token': 'e2e-reset' },
    data: { key, validFrom, value },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).ok).toBe(true);
}

/**
 * Wartet, bis React die Handler dieser Seite angehängt hat.
 *
 * Ein Feld steht schon im servergerenderten HTML: sichtbar, stabil und ohne
 * jede Wirkung, solange die Hydration nicht durch ist. Playwright sieht ein
 * fertiges Element und schreibt hinein — niemand hört zu, und die Eingabe
 * verfällt ersatzlos. Auf einem schnellen Rechner ist das Fenster winzig; auf
 * dem CI-Läufer kostete es am 14.09. einen roten Lauf, weil ein Upload spurlos
 * verschwand: die Datei lag hinterher weder im Ordner noch in „Alle Dateien“.
 *
 * Nach einem Seitenwechsel gehört eine Prüfung auf die neue Adresse davor.
 * Sonst ist die Bedingung am alten Dokument sofort erfüllt, das noch steht,
 * und der Helfer wartet auf nichts.
 *
 * `__reactProps$…` ist ein Interna von React. Benennt React es um, schlägt
 * dieser Helfer sichtbar fehl, statt stillschweigend durchzuwinken.
 */
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((key) => key.startsWith('__reactProps$'));
    },
    selector,
  );
}

/**
 * Zeilenaktion über das ⋯-Menü der Zeile (`RowMenu`, Joe 11.8): „Aktionen für …“ öffnen, dann den Eintrag wählen.
 */
export async function rowAction(page: Page, row: Locator, label: string | RegExp): Promise<void> {
  await row.getByRole('button', { name: /^Aktionen für / }).click();
  await page.getByRole('menuitem', { name: label }).click();
}

/**
 * Liest die Vorlage der Webseite ein und übernimmt sie, wenn es etwas zu übernehmen gibt. Ist der Stand schon
 * eingelesen (Seed), bietet die Seite kein „Übernehmen“ an (Runde 4, 175) — dann ist nichts zu tun.
 */
export async function readTemplate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Vorlage einlesen' }).click();
  const findings = page.getByRole('region', { name: 'Befunde' });
  await expect(findings).toBeVisible();
  const apply = findings.getByRole('button', { name: 'Übernehmen' });
  if ((await apply.count()) > 0) {
    await apply.click();
    await expect(page.getByRole('status')).toContainText('eingelesen');
  } else {
    await expect(findings.getByText('Keine Änderungen gegenüber dem eingelesenen Stand.')).toBeVisible();
  }
}

/**
 * Der Schritt „Bildkennzeichnung“ nach dem Hochladen von Bildern (Spec Bildkennzeichnung beim Hochladen): Im Seed ist
 * die Kennzeichnung eingeschaltet, also fragt der Dialog nach jedem Bild. `Fertig` (Mediathek, mehrere Fotos) führt
 * zurück, `Übernehmen` (ein Bildfeld) setzt die Datei ins Feld.
 */
export async function finishLabeling(page: Page, button: 'Fertig' | 'Übernehmen' = 'Fertig'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Bildkennzeichnung' });
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Erstellt auf der Backup-Seite ein Backup von Hand, wartet auf die Zeile „von Hand“ und lädt sie über das Zeilenmenü
 * herunter. Gibt den Pfad der Datei zurück.
 */
export async function createAndDownloadBackup(page: Page): Promise<string> {
  await page.goto('/admin/backup');
  await waitForHydration(page, '[data-testid="backup-create"]');
  await page.getByRole('button', { name: 'Backup erstellen' }).click();
  const row = page.getByRole('row').filter({ hasText: 'von Hand' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), rowAction(page, row, /^Herunterladen · /)]);
  expect(download.suggestedFilename()).toMatch(/^kompass-backup-test-\d{8}-\d{6}-manual\.tar$/);
  await expect(page.getByText(/Download gestartet/)).toBeVisible();
  return (await download.path())!;
}
