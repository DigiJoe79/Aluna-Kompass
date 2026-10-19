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
export async function setMailState(page: Page, state: 'off' | 'redirect' | 'blocked'): Promise<void> {
  const response = await page.request.post('/__e2e/mail', { headers: { 'x-e2e-token': 'e2e-reset' }, data: { state } });
  expect(response.ok()).toBe(true);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL('/');
}

export async function setE2ESetting(page: Page, key: string, value: unknown): Promise<void> {
  const response = await page.request.post('/__e2e/setting', {
    headers: { 'x-e2e-token': 'e2e-reset' },
    data: { key, value },
  });
  expect(response.ok()).toBe(true);
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
