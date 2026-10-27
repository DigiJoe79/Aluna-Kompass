import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { loginAsAdmin, resetDatabase } from './helpers';
import { STORY_YEAR, story, storyPattern } from './story-year';

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

  test('ohne Anschrift steht „Anschrift ergänzen“ statt „Ausstellen“; nach dem Ergänzen wird ausgestellt, unser Exemplar trägt ZWB (203)', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=uncertified');
    const line = group(page, 'Tobias Adler').getByTestId('uncertified-line').filter({ hasText: '50,00 €' });
    await expect(line.getByRole('button', { name: 'Ausstellen' })).toHaveCount(0);
    const remedy = line.getByRole('link', { name: 'Anschrift ergänzen' });
    await expect(remedy).toBeVisible();
    const contactHref = (await remedy.getAttribute('href'))!;
    expect(contactHref).toMatch(/^\/contacts\//);

    // Die Kontaktseite kennt (noch) kein Bearbeiten — die Anschrift kommt über das Werkzeug der Kontakte.
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'contacts_update', { id: contactHref.split('/').at(-1), street: 'Lärchenweg 3', postalCode: '12345', city: 'Musterstadt' });
    await client.close();

    let dialog = await openIssueDialog(page, 'Tobias Adler', '50,00 €');
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

  test('eine Bestätigung ohne maschinelles Verfahren entsteht mit Unterschriftsfeld; Schritt 3 nimmt die unterschriebene Fassung an', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations');
    // Dazu (Task 9) Sina Krügers Aufwandsspende aus dem Serienlauf des Vorjahrs — auch sie ohne Unterschrift.
    await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Unterschrift fehlt 2' })).toBeVisible();

    const dialog = await openIssueDialog(page, 'Lukas Hofmann', '36,00 €');
    await expect(dialog.getByTestId('issue-signature-mode')).toHaveText('mit Unterschriftsfeld');
    await expect(dialog.getByText('Ausstellen geht nur hier in Kompass, nicht über einen Agenten.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Ausstellen', exact: true }).click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ ausgestellt/)).toBeVisible();

    await page.goto('/finance/donations?tab=needsSignature');
    await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Unterschrift fehlt 3' })).toBeVisible();
    const card = page.getByTestId('signature-steps').filter({ hasText: '36,00 €' });
    // Kompakte Schritte (Entwurf E3): erzeugt ist erledigt, ablegen noch offen; das Verknüpfen ist kein eigener
    // Schritt mehr, es geschieht beim Ablegen (Runde 3, 204).
    await expect(card.locator('li[data-testid$="-created"]')).toHaveAttribute('data-state', 'done');
    await expect(card.locator('li[data-testid$="-upload"]')).toHaveAttribute('data-state', 'todo');
    await expect(card.locator('li[data-testid$="-linked"]')).toHaveCount(0);
    await card.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrieben.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') });
    await expect(page.getByText(/Unterschriebene Fassung ZWU-\S+ abgelegt/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Unterschrift fehlt 2' })).toBeVisible();
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

  test('Noch nicht bestätigt: blendet der Mindestbetrag alles aus, heißt das nicht „Alles bestätigt“', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=uncertified&min=99999999');
    await expect(page.getByText('Keine Zuwendung passt zu diesen Filtern.')).toBeVisible();
    await expect(page.getByText('Alles bestätigt')).toHaveCount(0);
    await expect(page.getByText(/^0 von \d+ Personen$/)).toBeVisible();
    await expect(page.getByLabel('Ab Betrag')).toHaveValue('999.999,99');
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).last().click();
    await expect(page).toHaveURL(/tab=uncertified$/);
    await expect(page.getByTestId('uncertified-group').first()).toBeVisible();
  });

  /** Spec Filterleisten § 4: Der Betrag gilt bei Enter, ohne Knopf „Anwenden“. */
  test('Noch nicht bestätigt: „Ab Betrag“ gilt bei Enter', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=uncertified');
    await expect(page.getByRole('button', { name: 'Anwenden' })).toHaveCount(0);
    await page.getByLabel('Ab Betrag').fill('99999');
    await page.getByLabel('Ab Betrag').press('Enter');
    await expect(page).toHaveURL(/tab=uncertified&min=9999900$/);
    await expect(page.getByRole('button', { name: 'Filter zurücksetzen' }).first()).toBeVisible();
  });

  test('Zurücknehmen verlangt den Grund und die Rückholspur; die Zeile ist danach wieder bescheinigbar', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/finance/donations?tab=uncertified');
    await expect(group(page, 'Erika Beispiel')).toHaveCount(0);

    await page.goto('/finance/donations');
    const row = issuedRow(page, 'Erika Beispiel');
    // Normalzustand ohne Marke in Listen (Designer Stufe 2 Nr. 6a).
    await expect(row.getByTestId('confirmation-state')).not.toContainText('gültig');
    await row.click();
    await page.getByRole('button', { name: 'Bestätigung zurücknehmen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Unser Exemplar bleibt in der Akte.')).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Bestätigung zurücknehmen' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Grund').fill('Betrag falsch zugeordnet');
    await dialog.getByLabel('Bereits versandt').check();
    await dialog.getByLabel('Original zurück am').fill(story('2026-09-01'));
    await submit.click();
    await expect(page.getByText(/Bestätigung ZWB-\S+ zurückgenommen/)).toBeVisible();
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('zurückgenommen');

    // Befund E: versandt, aber das Finanzamt ist noch nicht informiert — die Bestätigung bleibt ein offener Punkt, bis die Rückholspur steht.
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('Rückholspur unvollständig');
    await page.goto('/finance/donations?tab=toCorrect');
    await issuedRow(page, 'Erika Beispiel').click();
    await expect(page.getByTestId('confirmation-recall')).toContainText('Finanzamt informiert am: fehlt');
    await page.getByRole('button', { name: 'Rückholspur nachtragen' }).click();
    const recall = page.getByRole('dialog');
    await expect(recall.getByLabel('Original zurück am')).toHaveCount(0);
    await recall.getByLabel('Finanzamt informiert am').fill(story('2026-09-02'));
    await recall.getByRole('button', { name: 'Nachtragen' }).click();
    await expect(page.getByText(/Rückholspur zu ZWB-\S+ nachgetragen/)).toBeVisible();
    await page.goto('/finance/donations');
    await expect(issuedRow(page, 'Erika Beispiel')).not.toContainText('Rückholspur unvollständig');

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
    // Befund E: dazu Henriks zurückgenommene Bestätigung mit offener Rückholspur.
    await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Zu korrigieren 3' })).toBeVisible();
    await expect(issuedRow(page, 'Greta Sommer')).toContainText('Bescheid aufgehoben oder ersetzt');

    const client = await mcpClient(page, baseURL);
    const notices = await callTool<{ id: string }[] | { items: { id: string }[] }>(client, 'finance_notices_list', {});
    const list = Array.isArray(notices) ? notices : notices.items;
    expect(list).toHaveLength(1);
    const today = associationDay();
    await callTool(client, 'finance_notice_supersede', { id: list[0]!.id, supersededOn: today });
    await client.close();

    // Das Ersetzen des aktuell gültigen Bescheids trifft alle unter ihm ausgestellten, noch nicht
    // zurückgenommenen Bestätigungen: Erika, Lukas, Clara und die drei des Serienlaufs — dazu Greta, die
    // schon vorher „zu korrigieren“ war; Henrik zählt nur wegen der offenen Rückholspur (zurückgenommen).
    await page.goto('/finance/donations?tab=toCorrect');
    await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Zu korrigieren 8' })).toBeVisible();
    await expect(page.getByTestId('confirmation-row')).toHaveCount(8);
    await expect(issuedRow(page, 'Erika Beispiel')).toContainText('Bescheid aufgehoben oder ersetzt');
  });

  test('eine Zuwendung vor Beginn der Steuerbefreiung ist gesperrt — in der Prüfliste mit Sprung zu den Bescheiden und im Serienlauf', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    const year = STORY_YEAR;
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

  test('N4: die Prüfliste nennt alle Rückgabe-Entwürfe, nicht die Spende — die Abhilfe springt zum ersten, die übrigen sind verlinkt', async ({ page, baseURL }) => {
    await loginAsAdmin(page);
    const client = await mcpClient(page, baseURL);
    type Line = { lineId: string; entryId: string; entryNumber: string | null };
    const uncertified = await callTool<{ groups: { contactName: string; lines: Line[] }[] }>(client, 'finance_donations_uncertified', {});
    const gift = uncertified.groups.find((g) => g.contactName === 'Henrik Brandt')!.lines[0]!;
    const entry = await callTool<{ entryDate: string; moneyLines: { accountId: string }[]; allocationLines: { id: string; categoryId: string; contactId: string | null }[] }>(client, 'finance_entry_get', { id: gift.entryId });
    const line = entry.allocationLines.find((l) => l.id === gift.lineId)!;
    const draft = (cents: number) =>
      callTool<{ id: string }>(client, 'finance_entry_save_draft', {
        entryDate: entry.entryDate, text: 'Teilrückgabe an Henrik',
        moneyLines: [{ accountId: entry.moneyLines[0]!.accountId, amountCents: -cents }],
        allocationLines: [{ categoryId: line.categoryId, amountCents: -cents, contactId: line.contactId, originLineId: gift.lineId }],
      });
    const first = await draft(2500);
    const second = await draft(3000);
    await client.close();

    const dialog = await openIssueDialog(page, 'Henrik Brandt', '75,00 €');
    const missing = dialog.getByRole('region', { name: 'Fehlt noch' });
    await expect(missing).toContainText('Keine Rückgabe als Entwurf offen');
    await expect(missing).toContainText('über 25,00 €');
    await expect(missing).toContainText('über 30,00 €');
    if (gift.entryNumber) await expect(missing).not.toContainText(gift.entryNumber);
    const hrefs = await missing.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(expect.arrayContaining([`/finance/entries/${first.id}`, `/finance/entries/${second.id}`]));
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
    await expect(done).toContainText('Erfüllt · 14');
    await expect(notApplicable).toContainText('Trifft nicht zu · 3');
    await done.getByText('Erfüllt · 14').click();
    await notApplicable.getByText('Trifft nicht zu · 3').click();
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
    // 105, 203: Alle Arbeitsreiter tragen ihre Zahl, auch „Noch nicht bestätigt“.
    await page.goto('/finance/donations');
    await expect(page.getByRole('link', { name: /^Noch nicht bestätigt\s*\d+$/ })).toBeVisible();
    // 203: Die Abhilfe steht in der Zeile, einmal; die Marke im Kopf nennt nur den Zustand.
    await page.goto('/finance/donations?tab=uncertified');
    const adler = group(page, 'Tobias Adler');
    const line = adler.getByTestId('uncertified-line').filter({ hasText: '50,00 €' });
    await expect(line.getByRole('link', { name: 'Anschrift ergänzen' })).toBeVisible();
    await expect(line.getByText('Anschrift ergänzen')).toHaveCount(1);
    await expect(adler.getByText('Anschrift fehlt', { exact: true })).toBeVisible();

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
    await expect(lukas.getByTestId('confirmation-state')).not.toContainText('gültig'); // Normalzustand ohne Marke in Listen (Designer Stufe 2 Nr. 6a).
    await expect(lukas.getByTestId('confirmation-state').getByText('Unterschrift fehlt', { exact: true })).toBeVisible();
    await expect(issuedRow(page, 'Erika Beispiel').getByTestId('confirmation-state')).not.toContainText('Unterschrift fehlt');
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
 * 02.05.2025 (Veranlagungszeitraum 2020–2022, befreit ab 01.01.2020), den § 60a-Bescheid vom 01.03.2024, den er ersetzt, und Jonas Feld als vollständigen Unterzeichner (seit 01.01.2025,
 * mit Faksimile und Anzeige).
 */
const isoDay = (offsetDays = 0) => associationDay(offsetDays);
const germanDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const plusYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const SIGNATURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
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
    // Bei Bescheiden ist „gültig“ die Auskunft, die man sucht, und steht als Marke (Joe 11.7, Ausnahme von Stufe 2 Nr. 6a).
    await expect(seededExemption(page).getByTestId('notice-state')).toHaveText('gültig');
    await expect(seededExemption(page)).toContainText(`02.05.${STORY_YEAR + 4}`); // Bescheid vom 02.05. des Vorjahrs, gültig fünf Jahre
    await expect(seededExemption(page).getByTestId('notice-exempt-from')).toHaveText(`01.01.${STORY_YEAR - 6}`); // Veranlagungszeitraum vor den drei Jahren des Seeds (Joe F1); `story` verschiebt erst ab 2022
    // K9-Befund 8: sechs Spalten — Befreiung ab und gültig bis stehen zusammen unter „Gilt“, der Veranlagungszeitraum darunter.
    await expect(page.getByRole('table', { name: 'Bescheide des Finanzamts' }).getByRole('columnheader', { name: 'Gilt' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Bescheide des Finanzamts' }).getByRole('columnheader')).toHaveCount(6);
    // Endzustand gedämpft (Runde 4, 112): „ersetzt“ steht als Marke am Namen, die Zeile ist grau.
    await expect(noticeRow(page, 'vorläufige Anerkennung (§ 60a)')).toHaveAttribute('data-muted', '');
    await expect(noticeRow(page, 'vorläufige Anerkennung (§ 60a)').locator('[data-col="title"]')).toContainText('ersetzt'); // 09 B25
    await expect(noticeRow(page, 'vorläufige Anerkennung (§ 60a)').getByTestId('notice-state-date')).toContainText(story('02.05.2025'));

    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'Freistellungsbescheid' });
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Beispielstadt');
    await dialog.getByLabel('Steuernummer').fill('11/222/33333');
    await dialog.getByLabel('Datum des Bescheids').fill(today);
    await dialog.getByLabel('Steuerbefreiung ab').fill(story('2022-01-01'));
    await dialog.getByLabel('Veranlagungszeitraum').fill(story('2022–2024'));
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
    await expect(row.getByTestId('notice-state')).toHaveText('gültig'); // Joe 11.7: „gültig“ steht als Marke.
    await expect(row.getByTestId('notice-document')).toHaveText(/^EIN-/);
    await expect(row.getByTestId('notice-exempt-from')).toHaveText(story('01.01.2022'));
    await expect(row).toContainText(story('Veranlagungszeitraum 2022–2024'));

    await page.goto('/admin/settings?panel=tax');
    const managedValues = page.getByTestId('managed-field-value');
    // Befund 32 (0.2.1): das Datum im Format des Vereins, nicht als ISO.
    await expect(managedValues).toHaveText(['11/222/33333', 'Finanzamt Beispielstadt', 'Freistellungsbescheid', germanDay(today)]);
    // Fester Wert (H2): eine Gruppe mit Beschriftung und Wert, aber kein Eingabefeld.
    for (const label of ['Finanzamt', 'Steuernummer', 'Art des Bescheids', 'Datum des Bescheids']) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveCount(0);
    await expect(page.getByText('Wird unter Finanzen → Spenden → Bescheide geführt.')).toHaveCount(1);
    await expect(page.getByLabel('Satzungszweck')).toHaveCount(0);
  });

  test('ohne „Steuerbefreiung ab“ wird kein Bescheid gespeichert', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Erster Tag des Veranlagungszeitraums, ab dem der Bescheid die Befreiung ausspricht.')).toBeVisible();
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Beispielstadt');
    await dialog.getByLabel('Steuernummer').fill('11/222/33333');
    await dialog.getByLabel('Datum des Bescheids').fill(isoDay());
    await dialog.getByLabel('Veranlagungszeitraum').fill(story('2024'));
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('Förderung des Sports');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.locator('#notice-exempt-from-error')).toHaveText('Pflichtfeld.');
    await expect(dialog.getByTestId('notice-form')).toBeVisible();

    await dialog.getByLabel('Steuerbefreiung ab').fill(story('2024-01-01'));
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bescheid gespeichert.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await expect(noticeRow(page, 'Finanzamt Beispielstadt').getByTestId('notice-exempt-from')).toHaveText(story('01.01.2024'));
  });

  test('ein § 60a-Bescheid verlangt den Zweck zusätzlich im Akkusativ; die Vorschau zeigt beide Sätze (N8)', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'vorläufige Anerkennung (§\u00a060a)' });
    await dialog.getByRole('radiogroup', { name: 'Wurde bereits ein Freistellungsbescheid erteilt?' }).getByRole('radio', { name: 'Nein' }).check();
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Beispielstadt');
    await dialog.getByLabel('Steuernummer').fill('22/333/44444');
    // Vor dem endgültigen Freistellungsbescheid des Seeds (02.05.2025) — sonst greift die Ablehnung aus dem nächsten Test.
    await dialog.getByLabel('Datum des Bescheids').fill(story('2024-06-01'));
    await dialog.getByLabel('Steuerbefreiung ab').fill(story('2024-01-01'));
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO)');

    const preview = dialog.getByTestId('notice-purposes-preview');
    await expect(preview).toContainText('nur zur Förderung des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO)');

    // Ohne den zweiten Wortlaut wird nicht gespeichert (N8 — sonst würde "Wir fördern nach unserer Satzung" den Genitiv tragen).
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog.locator('#notice-purposes-accusative-error')).toHaveText('Pflichtfeld.');

    await dialog.getByLabel('Begünstigte Zwecke, im Akkusativ (§ 60a)').fill('den Tierschutz (§ 52 Abs. 2 Satz 1 Nr. 14 AO)');
    await expect(preview).toContainText('Wir fördern nach unserer Satzung den Tierschutz (§ 52 Abs. 2 Satz 1 Nr. 14 AO).');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bescheid gespeichert.')).toBeVisible();
  });

  test('ein § 60a-Bescheid nach einem Freistellungsbescheid wird abgelehnt', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    await page.getByRole('button', { name: 'Bescheid erfassen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Art des Bescheids').selectOption({ label: 'vorläufige Anerkennung (§\u00a060a)' });
    await expect(dialog.getByLabel('Veranlagungszeitraum')).toHaveCount(0);
    const question = dialog.getByRole('radiogroup', { name: 'Wurde bereits ein Freistellungsbescheid erteilt?' });
    await question.getByRole('radio', { name: 'Ja' }).check();
    await expect(dialog.getByText('Dann erfassen Sie bitte den Freistellungsbescheid')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();

    await question.getByRole('radio', { name: 'Nein' }).check();
    await dialog.getByLabel('Finanzamt').fill('Finanzamt Musterstadt');
    await dialog.getByLabel('Steuernummer').fill('99/999/99990');
    await dialog.getByLabel('Datum des Bescheids').fill(isoDay());
    await dialog.getByLabel('Steuerbefreiung ab').fill(isoDay());
    await dialog.getByLabel('Begünstigte Zwecke im Wortlaut').fill('des Sports');
    await dialog.getByLabel('Begünstigte Zwecke, im Akkusativ (§ 60a)').fill('den Sport');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText(storyPattern('Es gibt schon einen endgültigen Bescheid vom 02\\.05\\.2025')).first()).toBeVisible();
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
    await panel.getByTestId('signer-row').filter({ hasText: 'Jonas Feld' }).getByRole('button', { name: /^Aktionen für / }).click();
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
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
    await expect(machineStep).toContainText('Sonst tragen Bestätigungen ein Unterschriftsfeld');
    await expect(machineStep.getByRole('link', { name: 'Erledigen' })).toHaveAttribute('href', '/finance/donations/notices');

    await page.goto('/finance/donations/notices');
    await page.getByTestId('machine-panel').getByTestId('signer-row').filter({ hasText: 'Mara Winter' }).getByRole('button', { name: /^Aktionen für / }).click();
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Angezeigt beim Finanzamt am').fill(today);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('machine-status')).toContainText('Vollständig');

    await page.goto('/admin/finance?panel=checklist');
    await expect(page.getByTestId('requirement-notice')).toContainText('Ohne Bescheid keine Zuwendungsbestätigungen');
    await expect(page.getByTestId('requirement-notice')).not.toContainText(/\d{4}-\d{2}-\d{2}/); // Datum im Format des Vereins, nie ISO
    await expect(page.getByTestId('requirement-machineProcedure')).toHaveAttribute('data-done', 'true');
  });

  test('das Faksimile wird über die Ablagefläche hochgeladen, ein PDF wird am Feld abgelehnt', async ({ page }) => {
    await page.goto('/finance/donations/notices');
    // Jonas Feld trägt aus dem Seed schon ein Faksimile — die Zelle zeigt das Bild, „Ersetzen“ im Zeilenmenü öffnet die
    // Ablage (Runde 3, 112).
    const jonas = page.getByTestId('machine-panel').getByTestId('signer-row').filter({ hasText: 'Jonas Feld' });
    await expect(jonas.getByRole('button', { name: 'Ersetzen', exact: true })).toHaveCount(0);
    await jonas.getByRole('button', { name: /^Aktionen für / }).click();
    await page.getByRole('menuitem', { name: 'Ersetzen' }).click();

    await jonas.getByTestId('voucher-file-input').setInputFiles({ name: 'bescheid.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(jonas.getByRole('alert')).toHaveText('Das ist ein PDF. Hier braucht es ein Bild der Unterschrift (PNG oder JPEG).');

    await jonas.getByTestId('voucher-file-input').setInputFiles({ name: 'unterschrift.png', mimeType: 'image/png', buffer: SIGNATURE_PNG });
    await expect(page.getByText('Bild der Unterschrift gespeichert.')).toBeVisible();
    const preview = jonas.getByRole('img', { name: 'Unterschrift von Jonas Feld' });
    await expect(preview).toHaveAttribute('src', /^\/finance\/donations\/facsimile\?signerId=/);
  });

  test('„Aufgehoben oder ersetzt am“ beendet die Gültigkeit taggenau', async ({ page }) => {
    const tomorrow = isoDay(1);
    const today = isoDay();
    await page.goto('/finance/donations/notices');
    const row = seededExemption(page);

    // Ab morgen: heute trägt er noch.
    await row.getByTestId('notice-menu').click();
    await page.getByRole('menuitem', { name: 'Aufgehoben oder ersetzt am …' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Aufgehoben oder ersetzt am').fill(tomorrow);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('notice-state')).toHaveText(`gültig — endet mit Ablauf des ${germanDay(today)}`);
    await row.getByTestId('notice-menu').click();
    await expect(page.getByRole('menuitem', { name: 'Aufgehoben oder ersetzt am …' })).toHaveCount(0);

    // Irrtümlich erfasst: trug nie.
    await page.getByRole('menuitem', { name: 'Irrtümlich erfasst' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Grund').fill('Falsches Finanzamt übernommen');
    await dialog.getByRole('button', { name: 'Irrtümlich erfasst' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveAttribute('data-muted', ''); // Endzustand gedämpft (Runde 4, 112)
    await expect(row.locator('[data-col="title"]')).toContainText('irrtümlich erfasst');
    await expect(page.getByText('Kein gültiger Bescheid — ohne Bescheid keine Zuwendungsbestätigungen.')).toBeVisible();
  });
});
