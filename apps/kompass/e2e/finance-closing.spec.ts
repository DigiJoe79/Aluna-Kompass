import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { callTool, mcpClient } from './expense-helpers';
import { loginAsAdmin, openFiscalYear, resetDatabase, setE2ESetting } from './helpers';
import { associationDay } from './association-day';
import { STORY_YEAR } from './story-year';

/**
 * Rechenschaft C2 — Jahresabschluss, Amtsübergabe, Fristen und Schwellen in der Oberfläche. Seed (C1 Task 12): Der
 * Jahresabschluss des Vorjahres ist fertig (MV am 14.03. mit Einzelentlastung), im Stichjahr eine Amtsübergabe am
 * 30.06. mit festgehaltenem Zwischenbericht und die Wiedervorlage „Jahresabschluss vor der Mitgliederversammlung“.
 * Jeder Test setzt die Datenbank zurück; Test 2 öffnet das Vorjahr wieder und storniert damit dessen Berichte.
 */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** Das Vorjahr des Stichjahrs, ausdrücklich gewählt: Nach Neujahr wäre die Vorgabe der Seite das Stichjahr. */
const openPreviousYear = (page: Page): Promise<string> => openFiscalYear(page, '/finance/closing', STORY_YEAR - 1);

test.describe('finance closing (Rechenschaft C2)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  // Das Vorjahr ist seit Befund 34 a nicht „Fertig.“ (USt-Jahreserklärung bewusst offen), das Jahr davor schon.
  test('Vorvorjahr: „Fertig.“ mit Ergebnis, „Schritte ansehen“ klappt die zwölf Schritte auf', async ({ page }) => {
    await openFiscalYear(page, '/finance/closing', STORY_YEAR - 2);
    const steps = page.getByTestId('closing-steps');
    await expect(steps.getByRole('status')).toContainText('Fertig.');
    await expect(page.locator('#step-statements')).toBeHidden();
    const toggle = page.getByRole('button', { name: 'Schritte ansehen' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#step-statements')).toBeVisible();
    await expect(page.locator('#step-taxReturn')).toHaveAttribute('data-state', 'done');
  });

  test('Vorjahr wiederöffnen, abschließen, Prüfpaket neu, Nachprüfung ohne geänderte Buchung bestätigen', async ({ page }) => {
    test.setTimeout(180_000);
    await openPreviousYear(page);
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Jahr wiederöffnen …' }).click();
    const reopen = page.getByTestId('closing-reopen-dialog');
    await reopen.getByLabel('Begründung').fill('Barbeleg Sommerfest nachgebucht.');
    await reopen.getByRole('button', { name: 'Wiederöffnen' }).click();
    await expect(reopen).toBeHidden();
    await expect(page.getByTestId('closing-reopened')).toContainText('Zu wiederholen');

    await page.getByTestId('closing-close').click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Abschließen' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator('#step-close')).toHaveAttribute('data-state', 'done');

    // Schritt 9 ist zu wiederholen: Prüffassungen und Prüfpaket neu erzeugen.
    await expect(page.locator('#step-auditPackage')).toHaveAttribute('data-state', 'active');
    await page.getByTestId('package-run-start').click();
    await expect(page.locator('#step-auditPackage')).toHaveAttribute('data-state', 'done', { timeout: 150_000 });

    const step10 = page.locator('#step-auditReport');
    await expect(step10).toHaveAttribute('data-state', 'active');
    await expect(step10).toContainText('Nachprüfung');
    // Ohne geänderte Buchung (Befund 3): keine Wahl zwischen Folgejahr und Nachtrag, nur bestätigen.
    await expect(step10.getByRole('radio')).toHaveCount(0);
    await step10.getByTestId('closing-confirm').click();
    const confirmStep = page.getByTestId('closing-confirm-dialog');
    // Ohne Begründung (Board 14d B): den Befund liefert Kompass.
    await expect(confirmStep.getByRole('textbox')).toHaveCount(0);
    await confirmStep.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(confirmStep).toBeHidden();
    // Die Freigabe steht wieder: Schritt 10 zeigt den Weg zum Festschreiben der Berichte.
    await expect(page.getByTestId('closing-finalize')).toBeVisible();
  });

  test('Schritt 11: eine Person vertagt — „Ergebnis nachtragen“, Speichern geht, der Schritt bleibt offen und nennt die Vertagung', async ({ page, baseURL }) => {
    const yearId = await openPreviousYear(page);
    // Ausgangslage über das Werkzeug: das Ergebnis der MV ohne Entscheidungen, damit Schritt 11 offen ist.
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true);
    const client = await mcpClient(page, baseURL);
    const result = (await callTool(client, 'finance_assembly_result', { fiscalYearId: yearId })) as { result: { assemblyOn: string; version: string }; persons: { contactId: string }[] };
    await callTool(client, 'finance_assembly_result_save', { fiscalYearId: yearId, assemblyOn: result.result.assemblyOn, dischargeMode: 'individual', discharges: result.persons.map((p) => ({ contactId: p.contactId, outcome: null })), expectedVersion: result.result.version });
    await client.close();
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', false);

    // Das Werkzeug-Token entsteht auf der Profilseite: zurück zum Jahresabschluss.
    await page.goto(`/finance/closing?year=${yearId}`);
    const step = page.locator('#step-assembly');
    // Mit gespeichertem, unvollständigem Ergebnis ist Schritt 11 nicht aktiv: Satz und „Ergebnis nachtragen“ (Board 14b).
    await expect(step).toHaveAttribute('data-state', 'todo');
    await step.getByTestId('closing-assembly-fill-in').click();
    const persons = page.getByTestId('closing-assembly-person');
    const count = await persons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) await persons.nth(i).getByRole('radio', { name: i === 0 ? 'vertagt' : 'erteilt' }).click();
    await expect(page.getByTestId('closing-assembly-open')).toBeVisible();
    const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/finance/closing'));
    await page.getByTestId('closing-assembly-save').click();
    await saved;
    // Speichern klappt das Formular wieder zu.
    await expect(page.getByTestId('closing-body-assembly')).toBeHidden();
    await page.reload();
    await expect(page.locator('#step-assembly')).toHaveAttribute('data-state', 'todo');
    await expect(page.locator('#step-assembly')).toContainText('vertagt');
  });

  test('Amtsübergabe des Stichjahres: Kasse zählen mit der neuen Person, Punkte abhaken, Protokoll drucken, Scan ablegen → „Fertig.“', async ({ page }) => {
    await openFiscalYear(page, '/finance/closing', STORY_YEAR);
    await page.getByTestId('closing-handover-line').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Amtsübergabe Schatzmeisteramt');
    await expect(page.getByTestId('handover-steps-interim')).toHaveAttribute('data-state', 'done');

    // Jede Kasse mit Bestand am Übergabetag wird gezählt, je Kasse ein Dialog (14c).
    const counts = page.getByTestId('handover-count');
    expect(await counts.count()).toBeGreaterThan(0);
    while ((await counts.count()) > 0) {
      const before = await counts.count();
      await counts.first().click();
      const dialog = page.getByRole('dialog');
      // Die neue Person zählt als zweite mit (Befund 4) — keine Wahl, kein „Im Beisein von“.
      await expect(dialog.getByRole('combobox', { name: 'Zweite zählende Person' })).toHaveValue('Lena Brückner');
      await expect(dialog.getByTestId('count-handover-witness')).toHaveCount(0);
      await dialog.getByLabel('Gezählter Betrag').fill('0,00');
      const line = await dialog.getByText(/^Buchbestand /).textContent();
      const book = /Buchbestand ([\d.,]+)/.exec(line ?? '')![1]!;
      await dialog.getByLabel('Gezählter Betrag').fill(book);
      await dialog.getByRole('button', { name: 'Zählung speichern' }).click();
      await expect(dialog).toBeHidden();
      await expect(counts).toHaveCount(before - 1);
    }
    await expect(page.getByTestId('handover-steps-cash')).toHaveAttribute('data-state', 'done');

    for (const box of await page.getByTestId('handover-item').getByRole('checkbox').all()) await box.check();
    await page.getByTestId('handover-items-save').click();
    await expect(page.getByTestId('handover-items-save')).toBeVisible();
    await page.reload();
    for (const box of await page.getByTestId('handover-item').getByRole('checkbox').all()) await expect(box).toBeChecked();

    const printed = page.waitForResponse((r) => r.url().includes('/protocol'));
    await page.getByTestId('handover-print').click();
    const response = await printed;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');

    await page.getByTestId('handover-scan').click();
    const scan = page.getByTestId('handover-scan-dialog');
    await scan.locator('input[type="file"]').setInputFiles({ name: 'protokoll.pdf', mimeType: 'application/pdf', buffer: PDF });
    await scan.getByRole('button', { name: 'Ablegen' }).click();
    await expect(scan).toBeHidden();
    await expect(page.getByTestId('handover-steps').getByRole('status')).toContainText('Fertig.');
  });

  test('Fristen und Schwellen: Wiedervorlage aus dem Seed abhaken → gedämpft', async ({ page }) => {
    await page.goto('/finance/deadlines');
    const row = page.getByTestId('follow-up-row').filter({ hasText: 'Jahresabschluss vor der Mitgliederversammlung' });
    await expect(row).toHaveAttribute('data-done', 'false');
    await row.getByRole('checkbox').click();
    await expect(row).toHaveAttribute('data-done', 'true');
    await expect(row).toHaveAttribute('data-muted', '');
  });

  test('Fristen: Umsatzsteuer-Voranmeldung Q3 aus dem Seed — „Abgabe eintragen …“, die Zeile verschwindet (E6a)', async ({ page }) => {
    await page.goto('/finance/deadlines');
    // Seed: Q2 ist abgegeben, Q3 (Software-Abo mit Leistungsdatum im Juli) offen — genau eine Voranmeldung steht da.
    const advance = page.getByTestId('deadline-row').and(page.locator('[data-kind="vatAdvanceReturn"]'));
    await expect(advance).toHaveCount(1);
    // Vom 31.08. bis 30.09. ist das Stichjahr das laufende und Q3 noch nicht vorbei (`scripts/e2e-kalender.sh`, 15.09.):
    // Statt des Knopfs steht der erste mögliche Tag, denn eine Abgabe davor lehnt Kompass ab (Befund 33).
    if (associationDay() <= `${STORY_YEAR}-09-30`) {
      await expect(advance.getByTestId('deadline-vat')).toHaveCount(0);
      await expect(advance.getByTestId('deadline-vat-from')).toHaveText(`Abgabe ab 01.10.${STORY_YEAR}`);
      return;
    }
    await advance.getByTestId('deadline-vat').click();
    const dialog = page.getByTestId('vat-dialog');
    await dialog.getByRole('button', { name: 'Eintragen' }).click();
    await expect(dialog).toBeHidden();
    await expect(advance).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('deadline-row').first()).toBeVisible();
    await expect(advance).toHaveCount(0);
  });
});
