import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers';

/**
 * Gemeinsame Schritte der Auslagen-Specs (F8a Tasks 5 und 6). Der Seed bringt
 * Jonas Feld mit `finance.approve` und `finance.read`, aber ohne Kontakt; die
 * Verwaltung (Anna Berger) ist mit keinem Kontakt verknüpft und verknüpft ihr
 * Konto einmal selbst mit Tomas Leitner. So reicht Anna ein, und Jonas gibt
 * frei — nie umgekehrt, und nie Anna ihre eigenen.
 */

export const PHONE = { width: 390, height: 844 };
export const EXPENSE_IBAN = 'DE93999999990000000001';
export const PDF = { name: 'rechnung.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') };

export async function linkOwnContact(page: Page): Promise<void> {
  await page.goto('/admin/users');
  const row = page.getByRole('row', { name: /Anna Berger/ });
  await row.getByRole('button', { name: 'Verknüpfen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Kontakt wählen' }).click();
  await page.getByTestId('contact-option').filter({ hasText: 'Tomas Leitner' }).click();
  await dialog.getByRole('button', { name: 'Verknüpfen' }).click();
  await expect(page.getByRole('row', { name: /Anna Berger/ }).getByRole('link', { name: 'Tomas Leitner' })).toBeVisible();
}

/** Ein MCP-Zugang im Namen der angemeldeten Person — schneller als das Formular, das Task 5 schon prüft. */
export async function mcpClient(page: Page, baseURL: string | undefined): Promise<Client> {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright Auslagen');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

export async function callTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return (result.structuredContent ?? JSON.parse((result.content as { text: string }[])[0]!.text)) as T;
}

interface ClaimResult {
  id: string;
  number: string | null;
  positions: { id: string }[];
}

/**
 * Ein Antrag über die Werkzeuge der einreichenden Person: ein Beleg mit PDF
 * (und auf Wunsch eine Fahrt), heute datiert; `submit: false` lässt ihn als
 * Entwurf stehen.
 */
export async function submitClaim(client: Client, o: { purpose: string; amountCents: number; trip?: boolean; waiver?: boolean; submit?: boolean }): Promise<ClaimResult> {
  const today = new Date().toISOString().slice(0, 10);
  const positions: Record<string, unknown>[] = [{ kind: 'receipt', positionDate: today, amountCents: o.amountCents, purpose: o.purpose }];
  if (o.trip) positions.push({ kind: 'trip', positionDate: today, tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Pflegestelle besuchen', tripKm: 84 });
  const draft = await callTool<ClaimResult>(client, 'finance_expense_draft_save', { waiver: o.waiver ?? false, iban: o.waiver ? null : EXPENSE_IBAN, positions });
  await callTool(client, 'finance_expense_receipt_upload', { claimId: draft.id, positionId: draft.positions[0]!.id, fileName: 'rechnung.pdf', contentBase64: PDF.buffer.toString('base64') });
  if (o.submit === false) return draft;
  return callTool<ClaimResult>(client, 'finance_expense_submit', { id: draft.id });
}

/** Von der Verwaltung aus ein Startpasswort für diese Person, dann als sie anmelden (Muster `finance-donation-run.spec.ts`). */
export async function switchTo(page: Page, name: string, email: string): Promise<void> {
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

export const switchToJonas = (page: Page) => switchTo(page, 'Jonas Feld', 'jonas@kompass.local');

export async function backToAdmin(page: Page): Promise<void> {
  await page.request.post('/logout');
  await loginAsAdmin(page);
}

/** Ablehnen in D3 mit Grund — als Freigeber angemeldet. */
export async function rejectInQueue(page: Page, claimId: string, reason: string): Promise<void> {
  await page.goto(`/finance/approvals?claim=${claimId}`);
  await page.getByTestId('approval-footer').getByRole('button', { name: 'Ablehnen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Grund').fill(reason);
  await dialog.getByRole('button', { name: 'Ablehnen' }).click();
  await expect(page.getByTestId('approval-result')).toContainText('abgelehnt');
}
