import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAsAdmin, resetDatabase } from './helpers';

/**
 * F6b Task 7 — Oberfläche C2 „Serienlauf“. Der Seed bringt im laufenden Jahr
 * unbestätigt: Henrik Brandt (seine Bestätigung ist zurückgenommen) und die
 * Sportfreunde Beispieltal — beide bereit, maschinell; die zweite
 * Aufwandsspende von Lukas Hofmann (braucht Unterschrift, die erste ist schon
 * einzeln bestätigt); Tobias Adler und die zwei Spender der Plattform-Auszahlung
 * ohne Anschrift; die Sachspende „Laptop“ von Clara Neumann ohne Angaben
 * (blockiert). Der Bescheid gilt, das maschinelle Verfahren ist vollständig.
 */
const YEAR = String(new Date().getUTCFullYear());

async function mcpClient(page: Page, baseURL: string | undefined): Promise<Client> {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright Serienlauf');
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

/** Wie `finance-donations.spec.ts`: ein Startpasswort über die Verwaltung, dann als diese Person anmelden. */
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

const step = (page: Page, key: string) => page.getByTestId(`guided-step-${key}`);
const runItem = (page: Page, name: string) => page.getByTestId('run-item').filter({ hasText: name });
const issuedRow = (page: Page, name: string) => page.getByTestId('confirmation-row').filter({ hasText: name });

/** Die Vorschau des laufenden Jahres, drei Bestätigungen ausstellen, warten, bis das Ergebnis steht. */
async function runToResult(page: Page): Promise<void> {
  await page.goto(`/finance/donations/run?year=${YEAR}`);
  await page.getByTestId('run-footer').getByRole('button', { name: '3 Bestätigungen ausstellen' }).click();
  await expect(step(page, 'result')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 });
}

test.describe('finance donation run', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
  });

  test('die Vorschau zählt in Bestätigungen und zeigt die drei Gruppen mit dem Nummernbereich', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations/run');
    await expect(step(page, 'selection')).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('Jahr').selectOption(YEAR);
    await page.getByRole('button', { name: 'Vorschau zeigen' }).click();
    await expect(step(page, 'preview')).toHaveAttribute('aria-current', 'step');
    await expect(page).toHaveURL(new RegExp(`year=${YEAR}`));

    const ready = page.getByTestId('run-group-ready');
    await expect(ready.getByRole('heading')).toHaveText('bereit · 2 Bestätigungen');
    await expect(ready.getByTestId('run-item')).toHaveCount(2);
    await expect(runItem(page, 'Henrik Brandt')).toContainText('1 Zuwendung');

    const signature = page.getByTestId('run-group-needsSignature');
    await expect(signature.getByRole('heading')).toHaveText('braucht Unterschrift · 1 Bestätigung');
    await expect(runItem(page, 'Lukas Hofmann')).toContainText('1 von 2 Zuwendungen; 1 bereits einzeln bestätigt');
    await expect(runItem(page, 'Lukas Hofmann')).toContainText('Aufwandsspende');

    const address = page.getByTestId('run-group-addressMissing');
    await expect(address.getByTestId('run-item')).toHaveCount(3);
    await expect(runItem(page, 'Tobias Adler').getByRole('link', { name: 'Anschrift ergänzen' })).toHaveAttribute('href', /^\/contacts\//);
    await expect(page.getByTestId('run-group-blocked').getByTestId('run-item').filter({ hasText: 'Clara Neumann' })).toContainText('Beleg fehlt');

    const footer = page.getByTestId('run-footer');
    const range = (await footer.getByTestId('run-number-range').textContent())!.trim();
    const [, first, last] = /^ZWB-\d{4}-(\d{3}) bis ZWB-\d{4}-(\d{3})$/.exec(range) ?? [];
    expect(Number(last) - Number(first), range).toBe(2);
    await expect(footer).toContainText('Ausstellen kann nur ein Mensch');
    await expect(footer.getByRole('button', { name: '3 Bestätigungen ausstellen' })).toBeEnabled();

    // Ausschließen rechnet neu und steht in der Adresse — ein Neuladen zeigt dieselbe Vorschau.
    await page.getByRole('combobox', { name: 'Ausschließen' }).fill('Sportfreunde');
    await page.getByRole('option', { name: /Sportfreunde Beispieltal/ }).click();
    await expect(footer.getByRole('button', { name: '2 Bestätigungen ausstellen' })).toBeVisible();
    await expect(page.getByTestId('run-excluded')).toContainText('Sportfreunde Beispieltal');
    await expect(page).toHaveURL(/exclude=/);
    await page.goto(page.url());
    await expect(page.getByTestId('run-footer').getByRole('button', { name: '2 Bestätigungen ausstellen' })).toBeVisible();
    await expect(page.getByTestId('run-excluded')).toContainText('Sportfreunde Beispieltal');
    await expect(runItem(page, 'Sportfreunde Beispieltal')).toHaveCount(0);
  });

  test('der Lauf stellt aus, zeigt den Fortschritt und endet mit zwei Sammel-PDFs', async ({ page }) => {
    await loginAsAdmin(page);
    // Das Fortsetzen antwortet zuerst nicht — so steht der Lauf sichtbar still, und ein Neuladen setzt ihn fort.
    const continueUrl = '**/finance/donations/run/*/continue';
    await page.route(continueUrl, (route) => route.fulfill({ status: 503, body: '' }));
    await page.goto(`/finance/donations/run?year=${YEAR}`);
    await page.getByTestId('run-footer').getByRole('button', { name: '3 Bestätigungen ausstellen' }).click();
    await expect(page).toHaveURL(/run=/);
    await expect(step(page, 'run')).toHaveAttribute('aria-current', 'step');
    const progress = page.getByTestId('run-progress');
    await expect(progress.getByRole('progressbar')).toHaveAttribute('max', '3');
    const status = progress.getByTestId('run-progress-status');
    await expect(status).toHaveText('0 von 3 Bestätigungen ausgestellt');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(progress).toContainText('Sie können die Seite verlassen');

    await page.unroute(continueUrl);
    await page.goto(page.url());
    await expect(step(page, 'result')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 });
    const result = page.getByTestId('run-result');
    await expect(result.getByTestId('run-summary')).toHaveText('3 von 3 Bestätigungen ausgestellt');

    const [machine] = await Promise.all([page.waitForEvent('download'), result.getByRole('button', { name: 'Maschinelle Bestätigungen (PDF) · 2' }).click()]);
    expect(machine.suggestedFilename()).toMatch(/maschinell\.pdf$/);
    const [signature] = await Promise.all([page.waitForEvent('download'), result.getByRole('button', { name: 'Zum Unterschreiben (PDF) · 1' }).click()]);
    expect(signature.suggestedFilename()).toMatch(/zum-unterschreiben\.pdf$/);

    await page.goto('/finance/donations');
    await expect(issuedRow(page, 'Sportfreunde Beispieltal')).toContainText('Sammel');
  });

  test('Versandvermerk für alle setzt nur die maschinellen; die zu unterschreibenden bleiben in „Unterschrift fehlt“', async ({ page }) => {
    await loginAsAdmin(page);
    await runToResult(page);
    const result = page.getByTestId('run-result');
    await expect(result.getByRole('link', { name: 'Unterschriebene Fassung fehlt · 1' })).toHaveAttribute('href', '/finance/donations?tab=needsSignature');

    await result.getByRole('button', { name: 'Versand für alle vermerken' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Ein Vermerk, kein Versand');
    await dialog.getByLabel('Weg').selectOption({ label: 'Post' });
    await dialog.getByRole('button', { name: 'Vermerken' }).click();
    await expect(dialog).toBeHidden();
    await expect(result.getByTestId('run-dispatched')).toHaveText(/^Versand vermerkt am \d{2}\.\d{2}\.\d{4} · Post$/);
    await expect(result.getByRole('button', { name: 'Versand für alle vermerken' })).toHaveCount(0);

    await page.goto('/finance/donations');
    await expect(issuedRow(page, 'Sportfreunde Beispieltal')).toContainText('Post');
    await expect(issuedRow(page, 'Henrik Brandt').filter({ hasText: 'Sammel' })).toContainText('Post');
    await expect(issuedRow(page, 'Lukas Hofmann').filter({ hasText: 'Sammel' })).not.toContainText('Post');
    // Dazu Sina Krügers Aufwandsspende aus dem Serienlauf des Vorjahrs — auch sie ohne Unterschrift.
    await expect(page.getByRole('tab', { name: 'Unterschrift fehlt (3)' })).toBeVisible();
    await page.goto('/finance/donations?tab=needsSignature');
    await expect(page.getByTestId('signature-steps').filter({ hasText: '36,00 €' })).toBeVisible();
  });

  test('ein Nachzügler-Lauf zeigt nur, was noch fehlt', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    await runToResult(page);
    const result = page.getByTestId('run-result');
    await expect(result.getByTestId('run-missing')).toContainText('4 Spender fehlen noch');
    await expect(result.getByTestId('run-missing')).toContainText('Tobias Adler');

    await result.getByRole('link', { name: 'Nachzügler-Lauf vorbereiten' }).click();
    await expect(page).toHaveURL(/followUp=/);
    await expect(step(page, 'preview')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('run-group-ready')).toHaveCount(0);
    for (const name of ['Henrik Brandt', 'Sportfreunde Beispieltal', 'Lukas Hofmann']) await expect(runItem(page, name)).toHaveCount(0);
    const followUpUrl = page.url();
    const contactHref = (await runItem(page, 'Tobias Adler').getByRole('link', { name: 'Anschrift ergänzen' }).getAttribute('href'))!;

    const client = await mcpClient(page, baseURL);
    await callTool(client, 'contacts_update', { id: contactHref.split('/').at(-1), street: 'Lärchenweg 3', postalCode: '12345', city: 'Musterstadt' });
    await client.close();

    await page.goto(followUpUrl);
    await expect(page.getByTestId('run-group-ready').getByTestId('run-item')).toHaveCount(1);
    await expect(runItem(page, 'Tobias Adler')).toBeVisible();
    await page.getByTestId('run-footer').getByRole('button', { name: '1 Bestätigung ausstellen' }).click();
    await expect(step(page, 'result')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 });
    await expect(page.getByTestId('run-summary')).toHaveText('1 von 1 Bestätigung ausgestellt');
    // Dazu der abgeschlossene Serienlauf des Vorjahrs aus dem Seed — eine Zeile, die hier immer mitzählt.
    const rows = page.getByTestId('run-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Nachzügler' })).toHaveCount(1);
  });

  test('ohne finance.donationsIssue sieht man Vorschau und Läufe, aber keinen Start', async ({ page }) => {
    await loginAsAdmin(page);
    await runToResult(page);
    await page.request.post('/logout');

    // Mira Klein trägt die Rolle „Kassenprüfer“: lesen ja, ausstellen nein.
    await loginAs(page, 'Mira Klein', 'mira@kompass.local');
    await page.goto(`/finance/donations/run?year=${YEAR}`);
    await expect(page.getByTestId('run-group-addressMissing')).toBeVisible();
    await expect(page.getByRole('button', { name: /ausstellen$/ })).toHaveCount(0);
    await expect(page.getByTestId('run-footer')).toContainText('Ausstellen braucht das Recht „Zuwendungsbestätigungen ausstellen“.');

    // Dazu der abgeschlossene Serienlauf des Vorjahrs aus dem Seed — sein Versandvermerk („Post“) unterscheidet
    // ihn von diesem Lauf, der noch keinen trägt.
    const row = page.getByTestId('run-row');
    await expect(row).toHaveCount(2);
    await row.filter({ hasNotText: 'Post' }).getByRole('link', { name: 'Öffnen' }).click();
    await expect(page.getByTestId('run-summary')).toHaveText('3 von 3 Bestätigungen ausgestellt');
    await expect(page.getByRole('button', { name: 'Maschinelle Bestätigungen (PDF) · 2' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Versand für alle vermerken' })).toHaveCount(0);
  });
});
