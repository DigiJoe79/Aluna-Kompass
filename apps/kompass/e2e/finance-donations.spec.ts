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
 * und eine Spende der Sportfreunde Beispieltal (Organisation).
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
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (1)' })).toBeVisible();

    const dialog = await openIssueDialog(page, 'Lukas Hofmann', '36,00 €');
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('mit Unterschriftsfeld');
    await expect(dialog.getByText('Ausstellen kann nur ein Mensch — nicht über ein Werkzeug für Agenten.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Ausstellen', exact: true }).click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ ausgestellt/)).toBeVisible();

    await page.goto('/finance/donations?tab=needsSignature');
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (2)' })).toBeVisible();
    const card = page.getByTestId('signature-steps').filter({ hasText: '36,00 €' });
    await expect(card.getByTestId('requirement-created')).toHaveAttribute('data-done', 'true');
    await expect(card.getByTestId('requirement-linked')).toHaveAttribute('data-done', 'false');
    await card.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrieben.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') });
    await expect(page.getByText(/Unterschriebene Fassung ZWU-\S+ abgelegt/)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (1)' })).toBeVisible();
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
    await expect(page.getByRole('tab', { name: 'Zu korrigieren (0)' })).toBeVisible();

    const client = await mcpClient(page, baseURL);
    const notices = await callTool<{ id: string }[] | { items: { id: string }[] }>(client, 'finance_notices_list', {});
    const list = Array.isArray(notices) ? notices : notices.items;
    expect(list).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    await callTool(client, 'finance_notice_supersede', { id: list[0]!.id, supersededOn: today });
    await client.close();

    await page.goto('/finance/donations?tab=toCorrect');
    await expect(page.getByRole('tab', { name: 'Zu korrigieren (3)' })).toBeVisible();
    await expect(page.getByTestId('confirmation-row')).toHaveCount(3);
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('Bescheid aufgehoben oder ersetzt');
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
