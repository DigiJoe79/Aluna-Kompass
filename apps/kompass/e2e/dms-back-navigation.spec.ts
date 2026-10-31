import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { callTool, mcpClient } from './expense-helpers';
import { loginAsAdmin, resetDatabase, waitForHydration } from './helpers';

/** Spec Rückweg aus der Akte (Backlog 103): Der Pfeil geht dorthin zurück, wo man herkam. */
const PDF = Buffer.from('%PDF-1.4\n% Rueckweg\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const DOCUMENT = /\/dms\/[0-9A-Z]{26}$/;

const backLink = (page: Page) => page.locator('main').getByRole('link', { name: /Zurück|Akte/ }).first();
const scrollTop = (page: Page) => page.locator('main').evaluate((main) => main.scrollTop);

async function openFirstDocument(page: Page) {
  await page.locator('main tbody a[href^="/dms/0"]').first().click();
  await expect(page).toHaveURL(DOCUMENT);
}

async function goBackByArrow(page: Page) {
  await expect(backLink(page)).toContainText('Zurück');
  await backLink(page).click();
}

async function fileLetter(page: Page, subject: string) {
  const dialog = page.getByRole('dialog', { name: 'Post ablegen' });
  await dialog.getByLabel('Datei').setInputFiles({ name: `2026-03-14 ${subject}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`${PDF.toString()}% ${subject}\n`) });
  await expect(dialog.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14', { timeout: 30_000 });
  await dialog.getByLabel('Dokumentart').selectOption('authority');
  await dialog.getByLabel('Betreff').fill(subject);
  await expect(dialog.getByLabel('Betreff')).toHaveValue(subject);
  await dialog.getByRole('button', { name: 'Ablegen' }).click();
  await expect(page).toHaveURL(DOCUMENT);
}

test.describe('Rückweg aus der Akte', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('aus der gefilterten, gescrollten Liste: Adresse und Stelle kommen wieder', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto('/dms?phase=issued');
    await expect.poll(() => page.locator('main').evaluate((main) => main.scrollHeight - main.clientHeight)).toBeGreaterThan(120);
    await page.locator('main').evaluate((main) => { main.scrollTop = 120; });
    await expect.poll(() => scrollTop(page)).toBe(120);
    await page.waitForTimeout(100);
    await openFirstDocument(page);
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms\?phase=issued$/);
    await expect.poll(() => scrollTop(page)).toBe(120);
  });

  test('am Telefon genauso', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto('/dms?phase=issued');
    await page.locator('main').evaluate((main) => { main.scrollTop = 120; });
    await expect.poll(() => scrollTop(page)).toBe(120);
    await page.waitForTimeout(100);
    await page.locator('main a[href^="/dms/0"]').first().click();
    await expect(page).toHaveURL(DOCUMENT);
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms\?phase=issued$/);
    await expect.poll(() => scrollTop(page)).toBe(120);
  });

  test('von einem Kontakt: zurück beim Kontakt', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const { contacts } = await callTool<{ contacts: { id: string }[] }>(client, 'contacts_list', {});
    const { documents } = await callTool<{ documents: { id: string }[] }>(client, 'dms_list', { limit: 1 });
    await callTool(client, 'dms_link', { documentId: documents[0]!.id, entityType: 'contact', entityId: contacts[0]!.id, role: 'about' });
    const contactPage = `/contacts/${contacts[0]!.id}`;
    await page.goto(contactPage);
    await page.locator(`main a[href="/dms/${documents[0]!.id}"]`).first().click();
    await expect(page).toHaveURL(DOCUMENT);
    await goBackByArrow(page);
    await expect(page).toHaveURL(new RegExp(`${contactPage}$`));
  });

  test('von Dokument zu Dokument: Schritt für Schritt zurück', async ({ page }) => {
    await page.goto('/dms');
    const list = page.url();
    const hrefs = await page.locator('main tbody a[href^="/dms/0"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
    let source = '';
    for (const href of hrefs) {
      await page.goto(href);
      if (await page.getByTestId('document-relations').locator('a[href^="/dms/0"]').count()) {
        source = href;
        break;
      }
    }
    expect(source).not.toBe('');
    await page.goto(list);
    await page.locator(`main a[href="${source}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${source}$`));
    await page.getByTestId('document-relations').locator('a[href^="/dms/0"]').first().click();
    await expect(page).not.toHaveURL(new RegExp(`${source}$`));
    await goBackByArrow(page);
    await expect(page).toHaveURL(new RegExp(`${source}$`));
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms$/);
  });

  test('Direktaufruf: Der Pfeil führt zur Akte', async ({ page, context }) => {
    await page.goto('/dms');
    const href = await page.locator('main tbody a[href^="/dms/0"]').first().getAttribute('href');
    const fresh = await context.newPage();
    await fresh.goto(href!);
    await expect(backLink(fresh)).toContainText('Akte');
    await backLink(fresh).click();
    await expect(fresh).toHaveURL(/\/dms$/);
    await fresh.close();
  });

  test('neuer Entwurf: Der Pfeil im Editor führt zum Dokument, danach zur Liste, nie ins leere Formular', async ({ page }) => {
    await page.goto('/dms');
    await page.getByRole('link', { name: 'Neuer Entwurf' }).click();
    await expect(page).toHaveURL(/\/dms\/new/);
    await page.getByLabel('Betreff').fill('Rückweg');
    await expect(page.getByLabel('Betreff')).toHaveValue('Rückweg');
    await page.getByLabel('Text').fill('Text');
    await page.getByRole('button', { name: 'Entwurf speichern' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.getByRole('link', { name: 'Dokument', exact: true }).click();
    await expect(page).toHaveURL(DOCUMENT);
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms$/);
  });

  test('aus dem Editor zum Dokument: Der nächste Pfeil geht zur Herkunft, nicht in den Editor', async ({ page }) => {
    await page.goto('/dms?phase=draft');
    await page.locator('main tbody a[href^="/dms/0"]').first().click();
    await expect(page).toHaveURL(DOCUMENT);
    await page.getByRole('link', { name: 'Bearbeiten' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.getByRole('link', { name: 'Dokument', exact: true }).click();
    await expect(page).toHaveURL(DOCUMENT);
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms\?phase=draft$/);
  });

  test('„Post ablegen“ über der gefilterten Liste: Der Pfeil zeigt die Liste', async ({ page }) => {
    await page.goto('/dms?phase=issued');
    await page.getByRole('button', { name: 'Post ablegen' }).click();
    await fileLetter(page, 'Abgelegt aus der Liste');
    await goBackByArrow(page);
    await expect(page).toHaveURL(/\/dms\?phase=issued$/);
  });

  test('Ablegen vom Kontakt aus: Der Pfeil führt zum Kontakt, nicht in den Dialog', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const { contacts } = await callTool<{ contacts: { id: string }[] }>(client, 'contacts_list', {});
    const contactPage = `/contacts/${contacts[0]!.id}`;
    await page.goto(contactPage);
    await page.locator('main a[href^="/dms/receive"]').first().click();
    await fileLetter(page, 'Abgelegt über die Adresse');
    await goBackByArrow(page);
    await expect(page).toHaveURL(new RegExp(`${contactPage}$`));
  });

  test('Änderung im Editor: Der Pfeil fragt nach und geht dann zurück', async ({ page }) => {
    await page.goto('/dms?phase=draft');
    await page.locator('main tbody a[href^="/dms/0"]').first().click();
    await expect(page).toHaveURL(DOCUMENT);
    const document = new URL(page.url()).pathname;
    await page.getByRole('link', { name: 'Bearbeiten' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await waitForHydration(page, '[data-slot="form-column"]');
    await page.getByLabel('Betreff').pressSequentially('x');
    await page.getByRole('link', { name: 'Dokument', exact: true }).click();
    await page.getByRole('button', { name: 'Seite verlassen' }).click();
    await expect(page).toHaveURL(new RegExp(`${document}$`));
  });
});
