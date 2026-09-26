import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F6a Task 7 — Oberfläche C1 „Zuwendungsbestätigungen“. Der Seed (aus Task 9
 * vorgezogen) bringt: den Freistellungsbescheid des Finanzamts Musterstadt,
 * den Unterzeichner Jonas Feld mit Faksimile und Anzeige, eine gültige
 * maschinelle Bestätigung für Erika Beispiel, eine Aufwandsspende von Lukas
 * Hofmann ohne unterschriebene Fassung, eine Sachspende von Clara Neumann mit
 * Bestätigung — und unbestätigt: eine Spende von Tobias Adler (ohne
 * Anschrift), eine zweite Aufwandsspende, eine zweite Sachspende ohne Angaben
 * und eine Spende der Sportfreunde Beispieltal (Organisation). Dazu (Task 9)
 * eine Bestätigung für Greta Sommer auf dem ersetzten § 60a-Bescheid (zu
 * korrigieren) und eine zurückgenommene für Henrik Brandt, dessen Spende
 * wieder unter „Noch nicht bestätigt“ steht.
 */

/** Ein API-Token aus dem Profil, damit der Test Dinge tun kann, für die es (noch) keine Oberfläche gibt. */
async function mcpClient(page: Page, baseURL: string | undefined): Promise<Client> {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright Spenden');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

type NoticeListed = { id: string; kind: string; taxOffice: string; taxNumber: string; noticeDate: string; assessmentPeriod: string | null; purposesText: string };

async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent ?? JSON.parse((result.content as { text: string }[])[0]!.text)) as T;
}

/** Wie `finance.spec.ts`: ein Startpasswort über die Verwaltung, dann als diese Person anmelden. */
async function loginAs(page: Page, name: string, email: string): Promise<void> {
  await loginAsAdmin(page);
  await page.goto('/admin/users');
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Neues Startpasswort' }).click();
  const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
  await page.request.post('/logout');
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(startPassword);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByLabel('Startpasswort').fill(startPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill('ein-neues-passwort-2026');
  await page.getByLabel('Passwort wiederholen').fill('ein-neues-passwort-2026');
  await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
  await expect(page).toHaveURL('/');
}

const group = (page: Page, name: string) => page.getByTestId('uncertified-group').filter({ hasText: name });
const issuedRow = (page: Page, name: string) => page.getByTestId('confirmation-row').filter({ hasText: name });

async function openIssueDialog(page: Page, contact: string, amount: string) {
  await page.goto('/finance/donations?tab=uncertified');
  await group(page, contact).getByTestId('uncertified-line').filter({ hasText: amount }).getByRole('button', { name: 'Ausstellen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('requirement-list')).toBeVisible();
  return dialog;
}

test.describe('finance donations', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('die Prüfliste nennt eine fehlende Anschrift mit Abhilfe und blockiert; nach dem Ergänzen wird ausgestellt, unser Exemplar trägt ZWB', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    let dialog = await openIssueDialog(page, 'Tobias Adler', '50,00 €');
    const address = dialog.getByTestId('requirement-contactComplete');
    await expect(address).toHaveAttribute('data-done', 'false');
    const remedy = address.getByRole('link', { name: 'Anschrift ergänzen' });
    await expect(remedy).toBeVisible();
    const contactHref = (await remedy.getAttribute('href'))!;
    expect(contactHref).toMatch(/^\/contacts\//);
    await expect(dialog.getByRole('button', { name: 'Ausstellen', exact: true })).toBeDisabled();
    await expect(dialog.getByTestId('requirement-noticeValid')).toHaveAttribute('data-done', 'true');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    // Die Kontaktseite kennt (noch) kein Bearbeiten — die Anschrift kommt über das Werkzeug der Kontakte.
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'contacts_update', { id: contactHref.split('/').at(-1), street: 'Lärchenweg 3', postalCode: '12345', city: 'Musterstadt' });
    await client.close();

    dialog = await openIssueDialog(page, 'Tobias Adler', '50,00 €');
    await expect(dialog.getByTestId('requirement-contactComplete')).toHaveAttribute('data-done', 'true');
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('maschinell erstellt');
    await expect(dialog.getByTestId('confirmation-preview')).toHaveAttribute('src', /^blob:/);
    await dialog.getByRole('button', { name: 'Ausstellen', exact: true }).click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ ausgestellt/)).toBeVisible();

    await page.goto('/finance/donations');
    const row = issuedRow(page, 'Tobias Adler');
    await expect(row).toContainText(/ZWB-/);
    await row.click();
    const copy = page.getByRole('link', { name: 'Unser Exemplar (PDF)' });
    const response = await page.request.get((await copy.getAttribute('href'))!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
  });

  test('eine Bestätigung ohne maschinelles Verfahren entsteht mit Unterschriftsfeld; der Vierschritt nimmt die unterschriebene Fassung an', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations');
    // Dazu (Task 9) Sina Krügers Aufwandsspende aus dem Serienlauf des Vorjahrs — auch sie ohne Unterschrift.
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (2)' })).toBeVisible();

    const dialog = await openIssueDialog(page, 'Lukas Hofmann', '36,00 €');
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('mit Unterschriftsfeld');
    await expect(dialog.getByText('Ausstellen kann nur ein Mensch — nicht über ein Werkzeug für Agenten.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Ausstellen', exact: true }).click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ ausgestellt/)).toBeVisible();

    await page.goto('/finance/donations?tab=needsSignature');
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (3)' })).toBeVisible();
    const card = page.getByTestId('signature-steps').filter({ hasText: '36,00 €' });
    await expect(card.getByTestId('requirement-created')).toHaveAttribute('data-done', 'true');
    await expect(card.getByTestId('requirement-linked')).toHaveAttribute('data-done', 'false');
    await card.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrieben.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') });
    await expect(page.getByText(/Unterschriebene Fassung ZWU-\S+ abgelegt/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (2)' })).toBeVisible();
    await expect(page.getByTestId('signature-steps').filter({ hasText: '36,00 €' })).toHaveCount(0);
  });

  test('Sachspende: Details erfassen, Bestätigung über Sachzuwendungen ausstellen (Prüfstein 5)', async ({ page }) => {
    await loginAsAdmin(page);
    const dialog = await openIssueDialog(page, 'Clara Neumann', '200,00 €');
    await expect(dialog.getByTestId('requirement-inKindDetails')).toHaveAttribute('data-done', 'false');
    await expect(dialog.getByRole('button', { name: 'Ausstellen', exact: true })).toBeDisabled();

    await dialog.getByLabel('Gegenstand').fill('Laptop, 14 Zoll');
    await dialog.getByLabel('Zustand und Alter').fill('gebraucht, drei Jahre alt');
    await dialog.getByLabel('Wie wurde der Wert ermittelt?').fill('Preis vergleichbarer gebrauchter Geräte');
    await dialog.getByLabel('Herkunft').selectOption('private');
    await dialog.getByRole('combobox', { name: 'Wertunterlage' }).fill('Wertnachweis Laptop');
    await dialog.getByRole('option', { name: /Wertnachweis Laptop/ }).click();
    await dialog.getByRole('button', { name: 'Angaben speichern' }).click();

    await expect(dialog.getByTestId('requirement-inKindDetails')).toHaveAttribute('data-done', 'true');
    await expect(dialog.getByTestId('requirement-documented')).toHaveAttribute('data-done', 'true');
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('mit Unterschriftsfeld');
    await dialog.getByRole('button', { name: 'Ausstellen', exact: true }).click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ ausgestellt/)).toBeVisible();

    await page.goto('/finance/donations');
    const rows = issuedRow(page, 'Clara Neumann').filter({ hasText: '200,00 €' });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Sache');
  });

  test('Zurücknehmen verlangt den Grund und die Rückholspur; die Zeile ist danach wieder bescheinigbar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=uncertified');
    await expect(group(page, 'Erika Beispiel')).toHaveCount(0);

    await page.goto('/finance/donations');
    const row = issuedRow(page, 'Erika Beispiel');
    await expect(row).toContainText('gültig');
    await row.click();
    await page.getByRole('button', { name: 'Bestätigung zurücknehmen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Unser Exemplar bleibt in der Akte.')).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Bestätigung zurücknehmen' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Grund').fill('Betrag falsch zugeordnet');
    await dialog.getByLabel('Bereits versandt?').check();
    await dialog.getByLabel('Original zurück am').fill('2026-09-01');
    await submit.click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ zurückgenommen/)).toBeVisible();
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('zurückgenommen');

    await page.goto('/finance/donations?tab=uncertified');
    await expect(group(page, 'Erika Beispiel')).toContainText('250,00 €');
  });

  test('Korrigieren an einer bestätigten Zeile zeigt den Dreischritt statt der Feldauswahl', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations');
    const row = issuedRow(page, 'Erika Beispiel');
    const number = (await row.getByTestId('confirmation-number').textContent())!.trim();
    await row.click();
    await page.getByTestId('confirmation-detail').getByRole('link', { name: /^\d{4}-\d{4}$/ }).first().click();
    await expect(page).toHaveURL(/\/finance\/entries\//);

    await expect(page.getByTestId('entry-confirmations')).toContainText(`Bestätigung ${number}`);
    await page.getByRole('button', { name: 'Korrigieren' }).click();
    const dialog = page.getByRole('dialog');
    const steps = dialog.getByTestId('correction-three-steps');
    await expect(steps).toContainText(`Bestätigung ${number} zurücknehmen`);
    await expect(steps).toContainText('Korrigieren');
    await expect(steps).toContainText('Neu ausstellen');
    await expect(dialog.getByLabel('Spender/Empfänger')).toHaveCount(0);

    // Schritt 1 im Dialog: danach steht die gewohnte Feldauswahl da.
    await steps.getByRole('button', { name: `Bestätigung ${number} zurücknehmen` }).click();
    await dialog.getByLabel('Grund').fill('Falsche Spenderin');
    await dialog.getByRole('button', { name: 'Bestätigung zurücknehmen' }).click();
    await expect(page.getByText(`Bestätigung ${number} zurückgenommen`)).toBeVisible();
    await expect(dialog.getByLabel('Spender/Empfänger')).toBeVisible();
    await expect(dialog.getByTestId('correction-three-steps')).toHaveCount(0);
  });

  test('„Zu korrigieren“ zählt eine Bestätigung, deren Bescheid ersetzt wurde', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations');
    // Dazu (Task 9, Prüfstein 6) Nora Lehmanns Sammelbestätigung aus dem Serienlauf des Vorjahrs — ihre
    // Rücklastschrift zählt sie schon vor dem Ersetzen des Bescheids mit.
    await expect(page.getByRole('tab', { name: 'Zu korrigieren (2)' })).toBeVisible();
    await expect(issuedRow(page, 'Greta Sommer')).toContainText('Bescheid aufgehoben oder ersetzt');

    const client = await mcpClient(page, baseURL);
    const notices = await callTool<{ id: string }[] | { items: { id: string }[] }>(client, 'finance_notices_list', {});
    const list = Array.isArray(notices) ? notices : notices.items;
    expect(list).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    await callTool(client, 'finance_notice_supersede', { id: list[0]!.id, supersededOn: today });
    await client.close();

    // Das Ersetzen des aktuell gültigen Bescheids trifft alle unter ihm ausgestellten, noch nicht
    // zurückgenommenen Bestätigungen: Erika, Lukas, Clara und die drei des Serienlaufs — dazu Greta, die
    // schon vorher „zu korrigieren“ war; Henrik bleibt draußen (zurückgenommen).
    await page.goto('/finance/donations?tab=toCorrect');
    await expect(page.getByRole('tab', { name: 'Zu korrigieren (7)' })).toBeVisible();
    await expect(page.getByTestId('confirmation-row')).toHaveCount(7);
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('Bescheid aufgehoben oder ersetzt');
  });

  test('eine Zuwendung vor Beginn der Steuerbefreiung ist gesperrt — in der Prüfliste mit Sprung zu den Bescheiden und im Serienlauf', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    const year = new Date().getUTCFullYear();
    // Die Befreiung beginnt erst am 01.04. dieses Jahres: der § 60a-Bescheid war irrtümlich erfasst, der Freistellungsbescheid gilt ab April.
    const client = await mcpClient(page, baseURL);
    const listed = await callTool<NoticeListed[] | { items: NoticeListed[] }>(client, 'finance_notices_list', { includeInactive: true });
    const notices = Array.isArray(listed) ? listed : listed.items;
    const provisional = notices.find((n) => n.kind === 'section60a')!;
    const exemption = notices.find((n) => n.kind === 'exemptionNotice')!;
    await callTool(client, 'finance_notice_void', { id: provisional.id, note: 'Irrtümlich erfasst (Test)' });
    const { id, kind, taxOffice, taxNumber, noticeDate, assessmentPeriod, purposesText } = exemption;
    await callTool(client, 'finance_notice_save', { id, kind, taxOffice, taxNumber, noticeDate, assessmentPeriod, purposesText, exemptFrom: `${year}-04-01` });
    await client.close();

    // Henrik Brandt spendete am 20.03. — davor.
    const dialog = await openIssueDialog(page, 'Henrik Brandt', '75,00 €');
    const missing = dialog.getByRole('region', { name: 'Fehlt noch' });
    const row = missing.getByTestId('requirement-afterExemptionStart');
    await expect(row).toContainText('Zuwendung nicht vor Beginn der Steuerbefreiung');
    await expect(row).toContainText(`Die Zuwendung vom 20.03.${year} liegt vor dem 01.04.${year}; dafür darf keine Bestätigung ausgestellt werden.`);
    await expect(row.getByRole('link', { name: 'Bescheid und Beginn der Befreiung prüfen' })).toHaveAttribute('href', '/finance/donations/notices');
    await expect(dialog.getByRole('button', { name: 'Ausstellen', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: /Begründung|trotzdem richtig/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    await page.goto(`/finance/donations/run?year=${year}`);
    const blocked = page.getByTestId('run-group-blocked');
    await expect(blocked.getByTestId('run-item').filter({ hasText: 'Henrik Brandt' })).toContainText('Vor Beginn der Steuerbefreiung');
    await expect(page.getByTestId('run-group-beforeOldestNotice')).toHaveCount(0);
  });

  test('der Ausstellen-Knopf bleibt bei voller Prüfliste sichtbar; die Prüfliste zeigt „Fehlt noch“ und „Bitte ansehen“ nur, wenn es etwas gibt', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);
    // Henrik Brandt: Bestätigung zurückgenommen, die Spende steht wieder offen — nichts fehlt, nichts warnt.
    let dialog = await openIssueDialog(page, 'Henrik Brandt', '75,00 €');
    await expect(dialog.getByTestId('issue-dialog-head')).toContainText('Henrik Brandt');
    await expect(dialog.getByTestId('issue-dialog-head')).toContainText('75,00 €');
    await expect(dialog.getByRole('region', { name: 'Fehlt noch' })).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: 'Bitte ansehen' })).toHaveCount(0);
    const done = dialog.getByRole('region', { name: 'Erfüllt' });
    const notApplicable = dialog.getByRole('region', { name: 'Trifft nicht zu' });
    await expect(done).toContainText('Erfüllt · 11');
    await expect(notApplicable).toContainText('Trifft nicht zu · 2');
    await done.getByText('Erfüllt · 11').click();
    await notApplicable.getByText('Trifft nicht zu · 2').click();
    await expect(notApplicable.getByTestId('requirement-inKindDetails')).toContainText('Sachspende beschrieben');
    await expect(done.getByTestId('requirement-noticeValid')).toBeVisible();
    await expect(done.getByTestId('requirement-afterExemptionStart')).toContainText('Zuwendung nicht vor Beginn der Steuerbefreiung');
    const submit = dialog.getByRole('button', { name: 'Ausstellen', exact: true });
    await expect(submit).toBeEnabled();
    await expect(submit).toBeInViewport();
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('maschinell erstellt');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    // Eine Organisation warnt: „Bitte ansehen“ erscheint, „Fehlt noch“ nicht.
    dialog = await openIssueDialog(page, 'Sportfreunde Beispieltal', '100,00 €');
    await expect(dialog.getByRole('region', { name: 'Fehlt noch' })).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: 'Bitte ansehen' })).toContainText('Bestätigungen an Organisationen sind selten');
    await expect(dialog.getByRole('button', { name: 'Ausstellen', exact: true })).toBeInViewport();
  });

  test('eine Abhilfe steht einmal je Zeile, nicht im Badge und auf dem Knopf', async ({ page }) => {
    await loginAsAdmin(page);
    const dialog = await openIssueDialog(page, 'Tobias Adler', '50,00 €');
    const missing = dialog.getByRole('region', { name: 'Fehlt noch' });
    const address = missing.getByTestId('requirement-contactComplete');
    await expect(address.getByRole('link', { name: 'Anschrift ergänzen' })).toBeVisible();
    await expect(address.getByText('Anschrift ergänzen')).toHaveCount(1);
    await expect(dialog.getByRole('region', { name: 'Bitte ansehen' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    // Dieselbe Zeile in der Einrichtungs-Checkliste (E-4): „Erledigen“ nur auf dem Knopf.
    await page.goto('/admin/finance?panel=checklist');
    const tax = page.getByTestId('requirement-tax');
    await expect(tax).toHaveAttribute('data-done', 'false');
    await expect(tax.getByRole('link', { name: 'Erledigen' })).toBeVisible();
    await expect(tax.getByText('Erledigen', { exact: true })).toHaveCount(1);
  });

  test('„Unterschrift fehlt“ steht als Badge in der Liste', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations');
    const lukas = issuedRow(page, 'Lukas Hofmann');
    await expect(lukas.getByTestId('confirmation-state')).toContainText('gültig');
    await expect(lukas.getByTestId('confirmation-state').getByText('Unterschrift fehlt', { exact: true })).toBeVisible();
    await expect(issuedRow(page, 'Erika Beispiel').getByTestId('confirmation-state')).not.toContainText('Unterschrift fehlt');
  });

  test('eine unterschriebene Fassung über 1 MB kommt an (N9)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=needsSignature');
    const card = page.getByTestId('signature-steps').filter({ hasText: 'Lukas Hofmann' });
    await card.getByTestId('voucher-file-input').setInputFiles(BIG_PDF);
    await expect(page.getByText(/Unterschriebene Fassung \S+ abgelegt/)).toBeVisible();
  });

  test('ohne finance.donationsIssue sieht man Listen, aber weder Ausstellen noch Zurücknehmen; ohne finance.read gar nichts', async ({ page }) => {
    // Mira Klein trägt die Rolle „Kassenprüfer“: lesen ja, ausstellen nein.
    await loginAs(page, 'Mira Klein', 'mira@kompass.local');
    await page.goto('/finance/donations');
    const row = issuedRow(page, 'Erika Beispiel');
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('link', { name: 'Unser Exemplar (PDF)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bestätigung zurücknehmen' })).toHaveCount(0);
    await page.goto('/finance/donations?tab=uncertified');
    await expect(group(page, 'Tobias Adler')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ausstellen' })).toHaveCount(0);

    await page.request.post('/logout');
    await loginAs(page, 'Peter Lang', 'peter@kompass.local');
    await page.goto('/finance/donations');
    await expect(page.getByText('finance.read')).toBeVisible();
    await expect(page.getByTestId('confirmation-row')).toHaveCount(0);
  });
});

/**
 * F6a Task 8 — Oberfläche C3 „Bescheide“ und das maschinelle Verfahren. Der
 * Seed bringt den Freistellungsbescheid des Finanzamts Musterstadt vom
 * 02.05.2025, den § 60a-Bescheid vom 01.03.2024, den er ersetzt, und Jonas Feld als vollständigen Unterzeichner (seit 01.01.2025,
 * mit Faksimile und Anzeige).
 */
const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const germanDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const plusYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const SIGNATURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** N9/N11-Nachtrag (Befundliste 0.2.0): Dateien über 1 MB, erzeugt mit `docs/intern/recherche/2026-09-26-upload-repro/mkpdf.py`. */
const BIG_PDF = path.resolve(import.meta.dirname, 'fixtures/beleg-1500k.pdf');
/** Über 1 MB (dem Fund N9 entsprechend), unter `FACSIMILE_MAX_BYTES` (1 MiB). */
const BIG_FACSIMILE_PNG = path.resolve(import.meta.dirname, 'fixtures/faksimile-1003k.png');
const noticeRow = (page: Page, text: string) => page.getByTestId('notice-row').filter({ hasText: text });
/** Der Freistellungsbescheid aus dem Seed — dasselbe Finanzamt trägt auch den ersetzten § 60a-Bescheid. */
const seededExemption = (page: Page) => noticeRow(page, 'Finanzamt Musterstadt').filter({ hasText: 'Freistellungsbescheid' });

test.describe('finance donation notices', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('ein Freistellungsbescheid wird erfasst, die Vereinsdaten zeigen Finanzamt, Steuernummer und Bescheid (E22) und lassen sich dort nicht ändern', async ({ page }) => {
    const today = isoDay();
    await page.goto('/finance/donations/notices');
    await expect(seededExemption(page).getByTestId('notice-state')).toHaveText('gültig');
    await expect(seededExemption(page)).toContainText('02.05.2030');
    await expect(seededExemption(page).getByTestId('notice-exempt-from')).toHaveText('01.01.2023');
    await expect(page.getByRole('table', { name: 'Bescheide des Finanzamts' }).getByRole('columnheader', { name: 'Befreiung ab' })).toBeVisible();
    await expect(noticeRow(page, 'vorläufige Anerkennung (§ 60a)').getByTestId('notice-state')).toContainText('02.05.2025');

    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'Freistellungsbescheid' });
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Beispielstadt');
    await dialog.getByLabel('Steuernummer').fill('11/222/33333');
    await dialog.getByLabel('Datum des Bescheids').fill(today);
    await dialog.getByLabel('Steuerbefreiung ab').fill('2022-01-01');
    await dialog.getByLabel('Veranlagungszeitraum').fill('2022–2024');
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Sports (§ 52 Abs. 2 Satz 1 Nr. 21 AO)');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bescheid gespeichert.')).toBeVisible();

    // Zweiter Schritt im selben Dialog: das Dokument nachreichen.
    await expect(dialog.getByText('Reichen Sie den Bescheid als PDF nach')).toBeVisible();
    await dialog.getByTestId('voucher-file-input').setInputFiles({ name: 'bescheid.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByText(/Bescheid als \S+ in der Akte abgelegt/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await expect(dialog).toBeHidden();

    const row = noticeRow(page, 'Finanzamt Beispielstadt');
    await expect(row).toContainText('Freistellungsbescheid');
    await expect(row).toContainText('11/222/33333');
    await expect(row).toContainText(germanDay(plusYears(today, 5)));
    await expect(row.getByTestId('notice-state')).toHaveText('gültig');
    await expect(row.getByTestId('notice-document')).toHaveText(/^EIN-/);
    await expect(row.getByTestId('notice-exempt-from')).toHaveText('01.01.2022');

    await page.goto('/admin/settings');
    await page.getByRole('tab', { name: 'Steuer & Bescheide' }).click();
    const managedValues = page.getByTestId('managed-field-value');
    await expect(managedValues).toHaveText(['11/222/33333', 'Finanzamt Beispielstadt', 'Freistellungsbescheid', today]);
    for (const label of ['Finanzamt', 'Steuernummer', 'Art des Bescheids', 'Datum des Bescheids']) await expect(page.getByLabel(label)).toHaveCount(0);
    await expect(page.getByText('Wird unter Finanzen → Spenden → Bescheide geführt.')).toHaveCount(1);
    await expect(page.getByLabel('Satzungszweck')).toBeEditable();
  });

  test('ein Bescheid-Dokument über 1 MB kommt an (N9)', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'Freistellungsbescheid' });
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Großdatei');
    await dialog.getByLabel('Steuernummer').fill('11/222/33344');
    await dialog.getByLabel('Datum des Bescheids').fill(isoDay());
    await dialog.getByLabel('Steuerbefreiung ab').fill('2022-01-01');
    await dialog.getByLabel('Veranlagungszeitraum').fill('2022–2024');
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Sports (§ 52 Abs. 2 Satz 1 Nr. 21 AO)');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bescheid gespeichert.')).toBeVisible();

    await dialog.getByTestId('voucher-file-input').setInputFiles(BIG_PDF);
    await expect(page.getByText(/Bescheid als \S+ in der Akte abgelegt/)).toBeVisible();
  });

  test('ohne „Steuerbefreiung ab“ wird kein Bescheid gespeichert', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Erster Tag des Veranlagungszeitraums, ab dem der Bescheid die Befreiung ausspricht.')).toBeVisible();
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Beispielstadt');
    await dialog.getByLabel('Steuernummer').fill('11/222/33333');
    await dialog.getByLabel('Datum des Bescheids').fill(isoDay());
    await dialog.getByLabel('Veranlagungszeitraum').fill('2024');
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Sports');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.getByTestId('notice-exempt-from-error')).toHaveText('Pflichtfeld.');
    await expect(dialog.getByTestId('notice-form')).toBeVisible();

    await dialog.getByLabel('Steuerbefreiung ab').fill('2024-01-01');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bescheid gespeichert.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await expect(noticeRow(page, 'Finanzamt Beispielstadt').getByTestId('notice-exempt-from')).toHaveText('01.01.2024');
  });

  test('ein § 60a-Bescheid nach einem Freistellungsbescheid wird abgelehnt', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'vorläufige Anerkennung (§ 60a)' });
    await expect(dialog.getByLabel('Veranlagungszeitraum')).toHaveCount(0);
    const question = dialog.getByRole('radiogroup', { name: 'Wurde bereits ein Freistellungsbescheid erteilt?' });
    await question.getByLabel('Ja').check();
    await expect(dialog.getByText('Dann erfassen Sie bitte den Freistellungsbescheid')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();

    await question.getByLabel('Nein').check();
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Musterstadt');
    await dialog.getByLabel('Steuernummer').fill('99/999/99990');
    await dialog.getByLabel('Datum des Bescheids').fill(isoDay());
    await dialog.getByLabel('Steuerbefreiung ab').fill(isoDay());
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Sports');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText(/Es gibt schon einen endgültigen Bescheid vom 2025-05-02/).first()).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByTestId('notice-row')).toHaveCount(2);
  });

  test('Unterzeichner, Faksimile und Anzeige machen das Verfahren vollständig; die Checkliste zeigt beide Schritte', async ({ page }) => {
    const today = isoDay();
    await page.goto('/finance/donations/notices');
    const panel = page.getByTestId('machine-panel');
    const status = panel.getByTestId('machine-status');
    await expect(status).toContainText('Vollständig');

    // Amtsübergabe: Jonas Feld endet gestern, Mara Winter beginnt heute.
    await panel.getByTestId('signer-row').filter({ hasText: 'Jonas Feld' }).getByRole('button', { name: 'Bearbeiten' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gültig bis').fill(isoDay(-1));
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(status).toContainText('es fehlt: ein Unterzeichner für heute');

    await panel.getByRole('button', { name: 'Unterzeichner hinzufügen' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Mara Winter');
    await dialog.getByLabel('Gültig ab').fill(today);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(status).toContainText('es fehlt: das Bild der Unterschrift, der Tag der Anzeige beim Finanzamt');

    const mara = panel.getByTestId('signer-row').filter({ hasText: 'Mara Winter' });
    await expect(panel.getByText('Das Bild der Unterschrift liegt nicht in der Mediathek')).toBeVisible();
    await mara.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrift.png', mimeType: 'image/png', buffer: SIGNATURE_PNG });
    await expect(page.getByText('Bild der Unterschrift gespeichert.')).toBeVisible();
    const preview = mara.getByRole('img', { name: 'Unterschrift von Mara Winter' });
    await expect(preview).toHaveAttribute('src', /^\/finance\/donations\/facsimile\?signerId=/);
    await expect.poll(() => preview.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
    await expect(status).toContainText('es fehlt: der Tag der Anzeige beim Finanzamt');

    await panel.getByRole('button', { name: 'Anzeigeschreiben als Entwurf erzeugen' }).click();
    await expect(page.getByText('Das Anzeigeschreiben liegt als Entwurf in der Akte.')).toBeVisible();

    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-notice')).toHaveAttribute('data-done', 'true');
    const machineStep = page.getByTestId('requirement-machineProcedure');
    await expect(machineStep).toHaveAttribute('data-done', 'false');
    await expect(machineStep).toContainText('sonst tragen Bestätigungen ein Unterschriftsfeld');
    await expect(machineStep.getByRole('link', { name: 'Erledigen' })).toHaveAttribute('href', '/finance/donations/notices');

    await page.goto('/finance/donations/notices');
    await page.getByTestId('machine-panel').getByTestId('signer-row').filter({ hasText: 'Mara Winter' }).getByRole('button', { name: 'Bearbeiten' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Angezeigt beim Finanzamt am').fill(today);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('machine-status')).toContainText('Vollständig');

    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-notice')).toContainText('ohne Bescheid keine Zuwendungsbestätigungen');
    await expect(page.getByTestId('requirement-machineProcedure')).toHaveAttribute('data-done', 'true');
  });

  test('das Faksimile wird über die Ablagefläche hochgeladen, ein PDF wird am Feld abgelehnt', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    // Jonas Feld trägt aus dem Seed schon ein Faksimile — die Fläche zeigt zuerst die Vorschau, „ersetzen“ öffnet die Ablage.
    const jonas = page.getByTestId('machine-panel').getByTestId('signer-row').filter({ hasText: 'Jonas Feld' });
    await jonas.getByRole('button', { name: 'ersetzen' }).click();

    await jonas.getByTestId('voucher-file-input').setInputFiles({ name: 'bescheid.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(jonas.getByRole('alert')).toHaveText('Das ist ein PDF. Hier braucht es ein Bild der Unterschrift (PNG oder JPEG).');

    await jonas.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrift.png', mimeType: 'image/png', buffer: SIGNATURE_PNG });
    await expect(page.getByText('Bild der Unterschrift gespeichert.')).toBeVisible();
    const preview = jonas.getByRole('img', { name: 'Unterschrift von Jonas Feld' });
    await expect(preview).toHaveAttribute('src', /^\/finance\/donations\/facsimile\?signerId=/);
  });

  test('ein Faksimile über 1 MB kommt an (N9) — noch innerhalb der Grenze fürs Bild der Unterschrift', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    const jonas = page.getByTestId('machine-panel').getByTestId('signer-row').filter({ hasText: 'Jonas Feld' });
    await jonas.getByRole('button', { name: 'ersetzen' }).click();
    await jonas.getByTestId('voucher-file-input').setInputFiles(BIG_FACSIMILE_PNG);
    await expect(page.getByText('Bild der Unterschrift gespeichert.')).toBeVisible();
    await expect(jonas.getByRole('alert')).toHaveCount(0);
  });

  test('Tabellenkopf: Bescheide und Bestätigungen tragen denselben Hintergrund und dieselbe Schriftgröße', async ({ page }) => {
    await page.goto('/finance/donations');
    const confirmationsHead = page.locator('table thead').first();
    const background = await confirmationsHead.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fontSize = await confirmationsHead.evaluate((el) => getComputedStyle(el).fontSize);

    await page.goto('/finance/donations/notices');
    const noticesHead = page.getByRole('table', { name: 'Bescheide des Finanzamts' }).locator('thead');
    await expect(noticesHead).toHaveCSS('background-color', background);
    await expect(noticesHead).toHaveCSS('font-size', fontSize);
  });

  test('„Aufgehoben oder ersetzt am“ beendet die Gültigkeit taggenau', async ({ page }) => {
    const tomorrow = isoDay(1);
    const today = isoDay();
    await page.goto('/finance/donations/notices');
    const row = seededExemption(page);

    // Ab morgen: heute trägt er noch.
    await row.getByRole('button', { name: 'Aufgehoben oder ersetzt am …' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Aufgehoben oder ersetzt am').fill(tomorrow);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('notice-state')).toHaveText(`gültig — endet mit Ablauf des ${germanDay(today)}`);
    await expect(row.getByRole('button', { name: 'Aufgehoben oder ersetzt am …' })).toHaveCount(0);

    // Irrtümlich erfasst: trug nie.
    await row.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund').fill('Falsches Finanzamt übernommen');
    await dialog.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('notice-state')).toHaveText('irrtümlich erfasst');
    await expect(page.getByText('Kein gültiger Bescheid — ohne Bescheid keine Zuwendungsbestätigungen.')).toBeVisible();
  });
});
