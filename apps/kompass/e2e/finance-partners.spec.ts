import path from 'node:path';
import { expect, test } from './fixtures';
import { associationDay } from './association-day';
import { backToAdmin, callTool, mcpClient, PDF, switchTo, switchToJonas } from './expense-helpers';
import { loginAsAdmin, resetDatabase, setE2ESetting } from './helpers';
import { story } from './story-year';

/** > 1 MB (N9, Befundliste 0.2.0) — derselbe erfundene Beleg wie bei den Auslagen. */
const BIG_PDF = path.resolve(import.meta.dirname, 'fixtures/beleg-1500k.pdf');

/**
 * F7 Task 6b — Finanzen → Partner: Angaben, Zahlung an Partner, Nachweise.
 * Anna Berger (Verwaltung) legt Partner und Vorgänge an; Jonas Feld
 * (Freigeber) entscheidet — nie dieselbe Person wie die Anlegerin.
 */
test.describe('finance partners (F7)', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('legt einen Partner an, reicht eine Zahlung ein, gibt sie frei, sammelt einen Nachweis über 1 MB und erkennt ihn an', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Beispielhilfe gGmbH' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category', includeInactive: false })).find((c) => c.key === 'program-costs')!;

    await page.goto('/finance/partners');
    // Anlegen steht auf einer eigenen Seite (MUSTER.md § C), erreichbar über den Knopf der Liste.
    await page.getByRole('link', { name: 'Partner anlegen' }).click();
    await expect(page).toHaveURL(/\/finance\/partners\/new$/);
    // Ohne Kontakt gespeichert: die Feldmeldung steht am Kontakt, die Seite bleibt.
    await page.getByTestId('partner-create-form').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByTestId('partner-create-form').getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/finance\/partners\/new$/);
    await page.getByRole('combobox', { name: 'Kontakt' }).click();
    await page.getByTestId('contact-option').filter({ hasText: 'Beispielhilfe gGmbH' }).click();
    await page.getByLabel('Status').selectOption({ label: 'öffentliche Stelle' });
    await page.getByTestId('partner-create-form').getByRole('button', { name: 'Anlegen' }).click();
    await expect(page).toHaveURL(/\/finance\/partners\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Beispielhilfe gGmbH' })).toBeVisible();

    await page.getByTestId('partner-new-payment').click();
    await expect(page).toHaveURL(/\/finance\/partners\/[^/]+\/payments\/[^/]+$/);
    await page.getByLabel('Verwendungszweck').fill('Futterspende Winterhilfe');
    await page.getByTestId('position-add-money').click();
    await page.getByLabel('Betrag').fill('150,00');
    await page.getByLabel('Kategorie').selectOption(category.id);
    await page.getByTestId('payment-submit').click();
    await expect(page.getByTestId('payment-detail')).toBeVisible();
    // O (Prüfer Block 2): eingereicht heißt „wartet auf Freigabe“, nicht mehr „Entwurf“.
    await expect(page.getByTestId('guided-step-submitted')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('guided-step-draft')).toHaveAttribute('data-state', 'done');

    const paymentUrl = page.url();
    await switchToJonas(page);
    await page.goto('/finance/approvals');
    await page.getByTestId('approval-queue-item').filter({ hasText: 'Beispielhilfe gGmbH' }).click();
    await expect(page.getByTestId('approval-head')).toContainText('150,00 €');
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');

    // Der Nachweis (über 1 MB, N9) — legt die Verwaltung ab (finance.entriesWrite), nie die Freigeberin selbst.
    await backToAdmin(page);
    await page.goto(paymentUrl);
    await expect(page.getByTestId('guided-steps')).toBeVisible();
    // Förderung im Inland: nur der Zahlungsnachweis ist Pflicht (Spec 14.4); ein Bericht darf zusätzlich dabei sein.
    const list = page.getByTestId('evidence-requirements');
    await list.getByTestId('requirement-paymentProof').getByRole('button', { name: 'Hochladen oder verknüpfen' }).click();
    await page.getByTestId('evidence-form-paymentProof').getByTestId('voucher-file-input').setInputFiles(BIG_PDF);
    await page.getByTestId('evidence-form-paymentProof').getByRole('button', { name: 'Hochladen' }).click();
    await expect(list.getByTestId('requirement-paymentProof')).toHaveAttribute('data-done', 'true');

    // Anerkennen setzt voraus, dass die Zahlung passiert ist (Annahme 11) — ohne begleichende Buchung steht der Grund da, kein Knopf.
    await switchToJonas(page);
    await page.goto(paymentUrl);
    await expect(page.getByTestId('evidence-acknowledge-area')).toContainText('Die Zahlung ist noch nicht erfolgt.');
    // AM (Recheck sha-0170e73): eine Sperre am Zustand nennt, was sie löst — nie Personen, die es auch nicht können.
    await expect(page.getByTestId('evidence-acknowledge-area')).toContainText(/Sobald die Überweisung mit dem Verwendungszweck PZ-\d{4}-\d{3} gebucht ist, geht es weiter\./);
    await expect(page.getByTestId('evidence-acknowledge-area')).not.toContainText('Das kann erledigen');
    await expect(page.getByTestId('evidence-acknowledge')).toHaveCount(0);
    await expect(page.getByTestId('evidence-acknowledged')).toHaveCount(0);
  });

  test('nachträgliche Freigabe: eine schon gebuchte Zeile wird als bezahlt gewählt, ohne offenen Posten', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10) — hier nur, um die Ausgangslage zu buchen.
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Rückwirkend e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const entry = await callTool<{ id: string }>(client, 'finance_entry_book', {
      entryDate: associationDay(),
      text: 'Förderung Rückwirkend',
      moneyLines: [{ accountId: bank.id, amountCents: -8000 }],
      allocationLines: [{ categoryId: category.id, amountCents: -8000, contactId: org.id }],
    });
    void entry;

    await page.goto(`/finance/partners/${partner.id}`);
    await page.getByTestId('partner-new-payment').click();
    await page.getByLabel('Verwendungszweck').fill('Förderung, schon überwiesen');
    await page.getByTestId('payment-retroactive').getByRole('checkbox').check();
    await page.getByTestId('paid-line-picker').getByRole('checkbox').first().check();
    await page.getByTestId('payment-submit').click();
    await expect(page.getByTestId('payment-detail')).toContainText('80,00 €');

    await switchToJonas(page);
    await page.goto('/finance/approvals');
    await page.getByTestId('approval-queue-item').filter({ hasText: 'Rückwirkend e.V.' }).click();
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');
  });

  test('ein abgelehnter Vorgang bleibt sichtbar; die Kopie ist ein neuer Entwurf', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Ablehnpartner e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', {
      partnerId: partner.id,
      basis: 'transfer58',
      purposeText: 'Unklarer Zweck',
      retroactive: false,
      positions: [{ kind: 'money', amountCents: 2000, categoryId: category.id }],
    });
    const submitted = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    await page.getByTestId('partner-payment-reject').click();
    const rejectDialog = page.getByRole('dialog');
    await rejectDialog.getByLabel('Grund').fill('Verwendungszweck bitte genauer angeben');
    await rejectDialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Abgelehnt');

    // Kopieren ist `finance.entriesWrite` — Jonas hat als Freigeber nur `finance.approve` (Annahme: nie dieselbe Person).
    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    await expect(page.getByTestId('payment-detail')).toContainText('Verwendungszweck bitte genauer angeben');
    await page.getByTestId('payment-copy').click();
    await expect(page).toHaveURL(/\/payments\/(?!.*rejected)[^/]+$/);
    await expect(page.getByTestId('payment-draft-form')).toBeVisible();
  });

  test('D1: Speichern im Entwurf behält den per MCP gesetzten Zweck einer Geldposition', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Zweckpartner e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const purpose = await callTool<{ id: string }>(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Zweck D1 E2E' } });
    const draft = await callTool<{ id: string }>(client, 'finance_partner_payment_draft_save', {
      partnerId: partner.id,
      basis: 'transfer58',
      purposeText: 'Futter mit Zweck',
      retroactive: false,
      positions: [{ kind: 'money', amountCents: 3000, categoryId: category.id, purposeId: purpose.id }],
    });

    await page.goto(`/finance/partners/${partner.id}/payments/${draft.id}`);
    await page.getByLabel('Verwendungszweck').fill('Futter mit Zweck, genauer');
    await page.getByTestId('payment-save').click();
    await expect.poll(async () => (await callTool<{ purposeText: string }>(client, 'finance_partner_payment_get', { id: draft.id })).purposeText).toBe('Futter mit Zweck, genauer');
    const saved = await callTool<{ positions: { purposeId: string | null }[] }>(client, 'finance_partner_payment_get', { id: draft.id });
    expect(saved.positions[0]?.purposeId).toBe(purpose.id);
  });

  test('D1: „bezahlt aus“ wählt den Zweck einer Geldposition, MCP sieht ihn', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Zweckwahl e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const purpose = await callTool<{ id: string }>(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Zweckwahl D1 E2E' } });

    await page.goto(`/finance/partners/${partner.id}`);
    await page.getByTestId('partner-new-payment').click();
    await expect(page).toHaveURL(/\/payments\/[^/]+$/);
    const paymentId = page.url().split('/').pop()!;
    await page.getByLabel('Verwendungszweck').fill('Zweck im UI gewählt');
    await page.getByTestId('position-add-money').click();
    await page.getByLabel('Betrag').fill('40,00');
    await page.getByLabel('bezahlt aus').selectOption({ label: 'Zweckwahl D1 E2E' });
    await page.getByTestId('payment-save').click();
    await expect.poll(async () => (await callTool<{ positions: { purposeId: string | null }[] }>(client, 'finance_partner_payment_get', { id: paymentId })).positions[0]?.purposeId ?? null).toBe(purpose.id);
  });

  test('D2: fehlt der Bescheid, fragen Entwurf und Freigabe mit eigener Beschriftung nach', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Ohne Bescheid e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const money = (purposeText: string) => ({ partnerId: partner.id, basis: 'transfer58', purposeText, retroactive: false, positions: [{ kind: 'money', amountCents: 2500, categoryId: category.id }] });
    // Eingereicht, solange der Partner noch „Behörde“ ist; danach wird er steuerbegünstigt — ohne Bescheid.
    const early = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', money('Früh eingereicht'));
    await callTool(client, 'finance_partner_payment_submit', { id: early.id, expectedVersion: early.version });
    await callTool(client, 'finance_partner_save', { id: partner.id, contactId: org.id, status: 'taxExemptBody' });
    const late = await callTool<{ id: string }>(client, 'finance_partner_payment_draft_save', money('Später Entwurf'));

    await page.goto(`/finance/partners/${partner.id}/payments/${late.id}`);
    // Vorab (Design-Nachtrag Phase 4): der Warnkasten steht schon vor dem Einreichen da.
    await expect(page.getByTestId('reason-prompt').getByLabel('Begründung trotz fehlenden Bescheids')).toBeVisible();
    await page.getByTestId('payment-submit').click();
    const draftPrompt = page.getByTestId('reason-prompt');
    await expect(draftPrompt.getByLabel('Begründung trotz fehlenden Bescheids')).toBeVisible();
    await expect(draftPrompt).toContainText('Der Bescheid des Partners gilt am Zahlungstag nicht.');
    await expect(draftPrompt).not.toContainText('abweichende Art');

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${early.id}`);
    await page.getByTestId('partner-payment-approve').click();
    const approvalPrompt = page.getByTestId('reason-prompt');
    await expect(approvalPrompt.getByLabel('Begründung trotz fehlenden Bescheids')).toBeVisible();
    await expect(approvalPrompt).toContainText('Der Bescheid des Partners gilt am Zahlungstag nicht.');
    await expect(approvalPrompt).not.toContainText('abweichende Art');
  });

  test('D2: sind Nachweise überfällig, fragen Entwurf und Freigabe mit eigener Beschriftung nach', async ({ page, baseURL }) => {
    const today = associationDay();
    const newYear = `${today.slice(0, 4)}-01-01`;
    // Die Nachweisfrist läuft ab dem Tag der schon gebuchten Zeile (1 Monat, keine Kulanz); bis zum 1. Februar ist sie noch nicht vorbei.
    test.skip(today <= `${today.slice(0, 4)}-02-01`, 'Frist ab Neujahr ist erst ab dem 2. Februar überschritten');
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10).
    await setE2ESetting(page, 'finance.proofGraceDays', 0);
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Säumig e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody', usualProofMonths: 1 });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    await callTool(client, 'finance_entry_book', {
      entryDate: newYear,
      text: 'Förderung Säumig',
      moneyLines: [{ accountId: bank.id, amountCents: -5000 }],
      allocationLines: [{ categoryId: category.id, amountCents: -5000, contactId: org.id }],
    });
    const paidLine = (await callTool<{ id: string }[]>(client, 'finance_partner_eligible_lines', { partnerId: partner.id, kind: 'paidLine' }))[0]!;
    const old = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'transfer58', purposeText: 'Förderung Neujahr', retroactive: true, positions: [], paidLineIds: [paidLine.id] });
    await callTool(client, 'finance_partner_payment_submit', { id: old.id, expectedVersion: old.version });
    const money = (purposeText: string) => ({ partnerId: partner.id, basis: 'transfer58', purposeText, retroactive: false, positions: [{ kind: 'money', amountCents: 2500, categoryId: category.id }] });
    // Eingereicht, bevor die alte Zahlung freigegeben ist — da war noch nichts überfällig.
    const waiting = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', money('Wartet schon'));
    await callTool(client, 'finance_partner_payment_submit', { id: waiting.id, expectedVersion: waiting.version });
    const draft = await callTool<{ id: string }>(client, 'finance_partner_payment_draft_save', money('Neuer Entwurf'));

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${old.id}`);
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');
    await page.goto(`/finance/approvals?payment=${waiting.id}`);
    await page.getByTestId('partner-payment-approve').click();
    const approvalPrompt = page.getByTestId('reason-prompt');
    await expect(approvalPrompt.getByLabel('Begründung trotz überfälliger Nachweise')).toBeVisible();
    await expect(approvalPrompt).toContainText('Beim Partner sind Nachweise einer früheren Zahlung überfällig.');
    await expect(approvalPrompt).not.toContainText('abweichende Art');

    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}/payments/${draft.id}`);
    await expect(page.getByTestId('reason-prompt').getByLabel('Begründung trotz überfälliger Nachweise')).toBeVisible();
    await page.getByTestId('payment-submit').click();
    const draftPrompt = page.getByTestId('reason-prompt');
    await expect(draftPrompt.getByLabel('Begründung trotz überfälliger Nachweise')).toBeVisible();
    await expect(draftPrompt).toContainText('Beim Partner sind Nachweise einer früheren Zahlung überfällig.');
    await expect(draftPrompt).not.toContainText('abweichende Art');
  });

  test('D3/D6: der Entwurf heißt „Zahlung an Partner · Entwurf“, Löschen fragt nach', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Titelpartner e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const money = (purposeText: string) => ({ partnerId: partner.id, basis: 'transfer58', purposeText, retroactive: false, positions: [{ kind: 'money', amountCents: 1500, categoryId: category.id }] });
    const submitted = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', money('Mit Nummer'));
    await callTool(client, 'finance_partner_payment_submit', { id: submitted.id, expectedVersion: submitted.version });
    const draft = await callTool<{ id: string }>(client, 'finance_partner_payment_draft_save', money('Zum Löschen'));

    // Die Nummer vergibt erst die Freigabe (Jonas Feld, nie die Anlegerin).
    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');
    const number = (await callTool<{ number: string }>(client, 'finance_partner_payment_get', { id: submitted.id })).number;
    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    await expect(page.getByRole('heading', { name: `Zahlung an Partner · ${number}`, exact: true })).toBeVisible();

    await page.goto(`/finance/partners/${partner.id}/payments/${draft.id}`);
    await expect(page.getByRole('heading', { name: 'Zahlung an Partner · Entwurf', exact: true })).toBeVisible();
    await expect(page.getByText('Titelpartner e.V.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByTestId('payment-delete-draft').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Entwurf löschen?');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/payments/${draft.id}$`));

    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByTestId('payment-delete-draft').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Entwurf löschen' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/partners/${partner.id}$`));
    await expect(page.getByText('Zum Löschen')).toHaveCount(0);
  });

  test('Weitere Aktionen: ohne Vorgänge Löschen, mit Bescheid Löschen mit Grund, Archivieren mit Rückgängig und Wieder aktivieren', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const leer = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Leerpartner e.V.' });
    const leerPartner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: leer.id, status: 'taxExemptBody' });
    await page.goto(`/finance/partners/${leerPartner.id}`);
    // Speichern steht allein; Löschen steht im Seitenkopf unter „Weitere Aktionen“, nicht neben „Speichern“.
    await expect(page.getByTestId('partner-profile').getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByTestId('partner-delete-trigger').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
    await expect(page).toHaveURL(/\/finance\/partners$/);
    await expect(page.getByRole('row', { name: /Leerpartner/ })).toHaveCount(0);

    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Archivpartner e.V.' });
    const doc = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'bescheid.pdf', typeKey: 'minutes', subject: 'Bescheid Archivpartner', documentDate: story('2026-02-01'), contentBase64: PDF.buffer.toString('base64') });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'taxExemptBody' });
    await callTool(client, 'finance_partner_notice_save', { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: story('2026-03-15'), receivedOn: story('2026-03-20'), documentId: doc.id });
    await page.goto(`/finance/partners/${partner.id}`);
    const more = page.getByRole('button', { name: 'Weitere Aktionen' });
    // Mit Bescheid ist Löschen unmöglich: Der Eintrag bleibt, der Dialog nennt den Grund und bietet nur „Schließen“.
    await more.click();
    await page.getByTestId('partner-delete-trigger').click();
    const refusal = page.getByRole('alertdialog', { name: 'Partner löschen?' });
    await expect(refusal).toContainText('Archivieren Sie ihn stattdessen');
    await expect(refusal.getByRole('button', { name: 'Löschen' })).toHaveCount(0);
    await refusal.getByRole('button', { name: 'Schließen' }).click();
    await expect(more).toBeFocused();

    // Archivieren ohne Rückfrage; der Toast bietet „Rückgängig“, die Seite zeigt Marke und „Wieder aktivieren“.
    await more.click();
    await page.getByTestId('partner-archive-trigger').click();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Partner archiviert.' });
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
    await expect(page.getByTestId('partner-profile')).toContainText('deaktiviert');
    await expect(page.getByText('Archiviert', { exact: true })).toBeVisible();
    await expect(page.getByTestId('partner-activate-trigger')).toBeVisible();
    await toast.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByTestId('partner-profile')).not.toContainText('deaktiviert');
    await expect(page.getByTestId('partner-activate-trigger')).toHaveCount(0);

    // Der Gegenweg steht dauerhaft auf der Seite, nicht nur im Toast.
    await more.click();
    await page.getByTestId('partner-archive-trigger').click();
    await expect(page.getByTestId('partner-activate-trigger')).toBeVisible();
    await page.getByTestId('partner-activate-trigger').click();
    await expect(page.getByTestId('partner-profile')).not.toContainText('deaktiviert');

    // Einen Bescheid als irrtümlich erfasst kennzeichnen ist unumkehrbar: Rückfrage mit Folge und Begründung.
    await page.getByRole('button', { name: 'Als irrtümlich erfasst kennzeichnen …' }).click();
    const voidDialog = page.getByRole('alertdialog', { name: 'Bescheid als irrtümlich erfasst kennzeichnen?' });
    await expect(voidDialog).toContainText('Das lässt sich nicht zurücknehmen.');
    await expect(voidDialog.getByRole('button', { name: 'Als irrtümlich erfasst kennzeichnen' })).toBeDisabled();
    await voidDialog.getByLabel('Begründung').fill('Falscher Partner');
    await voidDialog.getByRole('button', { name: 'Als irrtümlich erfasst kennzeichnen' }).click();
    await expect(voidDialog).toBeHidden();
    await expect(page.getByTestId('partner-notices')).toContainText('irrtümlich erfasst');
  });

  test('D5: Leser sehen Registernachweis und Rahmenvereinbarung, das Bescheiddatum formatiert und „deaktiviert“ als Zustand', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Lesepartner e.V.' });
    const receive = (subject: string) => callTool<{ id: string }>(client, 'dms_receive', { filename: 'nachweis.pdf', typeKey: 'minutes', subject, documentDate: story('2026-02-01'), contentBase64: PDF.buffer.toString('base64') });
    const register = await receive('Registerauszug Lesepartner');
    const agreement = await receive('Rahmenvertrag Lesepartner');
    const noticeDoc = await receive('Freistellungsbescheid Lesepartner');
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'taxExemptBody', registerDocumentId: register.id, agreementDocumentId: agreement.id });
    await callTool(client, 'finance_partner_notice_save', { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: story('2026-03-15'), receivedOn: story('2026-03-20'), documentId: noticeDoc.id });
    await callTool(client, 'finance_partner_set_active', { id: partner.id, isActive: false });

    // Wer schreiben darf, sieht im Picker den Betreff, nicht ein leeres Feld.
    await page.goto(`/finance/partners/${partner.id}`);
    await expect(page.getByRole('combobox', { name: 'Registernachweis' })).toHaveValue(/Registerauszug Lesepartner/);
    await expect(page.getByRole('combobox', { name: 'Rahmenvereinbarung' })).toHaveValue(/Rahmenvertrag Lesepartner/);

    const role = await callTool<{ id: string }>(client, 'roles_create', { name: 'Finanzen lesen E2E' });
    await callTool(client, 'roles_set_permissions', { roleId: role.id, permissionKeys: ['finance.read', 'dms.view'] });
    const users = await callTool<{ id: string; email: string }[]>(client, 'users_list', {});
    await callTool(client, 'roles_assign', { userId: users.find((u) => u.email === 'peter@kompass.local')!.id, roleId: role.id });
    await switchTo(page, 'Peter Lang', 'peter@kompass.local');

    await page.goto(`/finance/partners/${partner.id}`);
    const profile = page.getByTestId('partner-profile');
    await expect(profile.getByRole('link', { name: /Registerauszug Lesepartner/ })).toHaveAttribute('href', `/dms/${register.id}`);
    await expect(profile.getByRole('link', { name: /Rahmenvertrag Lesepartner/ })).toHaveAttribute('href', `/dms/${agreement.id}`);
    await expect(profile).toContainText('deaktiviert');
    await expect(profile).not.toContainText('Deaktivieren');
    const notices = page.getByTestId('partner-notices');
    await expect(notices).toContainText('15.03.');
    await expect(notices).not.toContainText(story('2026-03-15'));

    // Ohne Recht auf die Akte: das Dokument ist hinterlegt, aber Nummer, Betreff und Link bleiben verborgen.
    await callTool(client, 'roles_set_permissions', { roleId: role.id, permissionKeys: ['finance.read'] });
    await page.reload();
    await expect(profile).toContainText('Registernachweis');
    await expect(profile).not.toContainText('Registerauszug Lesepartner');
    await expect(profile.getByRole('link', { name: /Registerauszug/ })).toHaveCount(0);
    await expect(profile).toContainText('ohne Zugriff auf die Akte');
  });
  test('E2 (Design-Nachtrag 4b): der Entwurf sichert laufend, die Nachweise folgen live der Art, die Frist in Monaten', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Partnerorganisation Beispielland' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'foreignBody', usualBasis: 'agent57' });

    await page.goto(`/finance/partners/${partner.id}`);
    await page.getByTestId('partner-new-payment').click();
    await expect(page).toHaveURL(/\/payments\/[^/]+$/);
    const paymentId = page.url().split('/').pop()!;

    const evidence = page.getByTestId('draft-required-evidence');
    await expect(evidence).toHaveAttribute('aria-live', 'polite');
    await expect(evidence).toContainText('Auftrag je Vorhaben');
    await expect(evidence).toContainText('Abrechnung mit Belegen');
    await expect(evidence).toContainText('Freigabe nur mit dem Auftrag.');
    await expect(page.getByTestId('payment-basis')).toContainText('vorbelegt aus den Angaben zum Partner: Auftrag an einen Partner');

    // Art übersteuern: die Liste wechselt sichtbar, der Warnkasten fragt nach dem Grund.
    await page.getByRole('radio', { name: 'Förderung eines Partners' }).check();
    await expect(evidence).toContainText('Empfangsbestätigung');
    await expect(evidence).toContainText('Rechnung oder Abrechnung');
    await expect(evidence).not.toContainText('Abrechnung mit Belegen');
    await page.getByLabel('Warum ist es hier eine Förderung?').fill('Der Partner entscheidet hier selbst über das Schulmaterial.');

    // Die Art wechselt auch mit der Tastatur.
    await page.getByRole('radio', { name: 'Förderung eines Partners' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Auftrag an einen Partner' })).toBeChecked();
    await expect(evidence).toContainText('Abrechnung mit Belegen');
    await page.getByRole('radio', { name: 'Förderung eines Partners' }).check();

    await page.getByLabel('Verwendungszweck').fill('Schulmaterial Grundschule Beispielort');
    await expect(page.getByTestId('payment-proof')).toContainText('aus der üblichen Frist: 3 Monate nach Zahlung');
    await page.getByLabel('Nachweisfrist').selectOption('5');
    await page.getByTestId('payment-retroactive').getByRole('checkbox').check();
    await expect(page.getByTestId('payment-retroactive-warn')).toContainText('Nachträgliche Freigabe');
    await page.getByTestId('payment-retroactive').getByRole('checkbox').uncheck();

    const status = page.getByTestId('payment-footer').getByTestId('save-status');
    await expect(status).toHaveAttribute('data-pending', 'false');
    await expect(status).toContainText(/Zwischenstand gespeichert · \d{2}:\d{2}/);
    const saved = await callTool<{ basis: string; purposeText: string; proofMonths: number; basisOverrideReason: string }>(client, 'finance_partner_payment_get', { id: paymentId });
    expect(saved).toMatchObject({ basis: 'transfer58', purposeText: 'Schulmaterial Grundschule Beispielort', proofMonths: 5, basisOverrideReason: 'Der Partner entscheidet hier selbst über das Schulmaterial.' });
    await expect(page.getByTestId('payment-footer')).toHaveCSS('position', 'sticky');
    await expect(page.getByTestId('payment-footer').getByRole('button', { name: 'Zur Freigabe geben' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(evidence).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('E2 nach der Freigabe (4b): Kopf mit Art und Frist, Schritte mit von/am, Nachweise je Pflichtart, Anerkennen mit Voraussetzung', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10) — nur für die Ausgangslage.
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Nachweispartner e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'foreignBody', usualBasis: 'transfer58' });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const agreement = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'vereinbarung.pdf', typeKey: 'minutes', subject: 'Vereinbarung Schulmaterial', documentDate: story('2026-02-01'), contentBase64: PDF.buffer.toString('base64') });
    await callTool(client, 'finance_entry_book', { entryDate: associationDay(), text: 'Förderung Nachweispartner', moneyLines: [{ accountId: bank.id, amountCents: -150000 }], allocationLines: [{ categoryId: category.id, amountCents: -150000, contactId: org.id }] });
    const paidLine = (await callTool<{ id: string }[]>(client, 'finance_partner_eligible_lines', { partnerId: partner.id, kind: 'paidLine' }))[0]!;
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'transfer58', purposeText: 'Schulmaterial', agreementDocumentId: agreement.id, retroactive: true, positions: [], paidLineIds: [paidLine.id] });
    const submitted = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');

    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    await expect(page.getByTestId('payment-head')).toContainText('Förderung eines Partners · 1.500,00 € · Nachweisfrist');
    await expect(page.getByTestId('guided-step-draft')).toContainText('Anna Berger');
    await expect(page.getByTestId('guided-step-approved')).toContainText('Jonas Feld');
    await expect(page.getByTestId('guided-step-paid')).toContainText('gezahlt');

    const list = page.getByTestId('evidence-requirements');
    await expect(list.getByTestId('requirement-agreement')).toHaveAttribute('data-done', 'true');
    await expect(list.getByTestId('requirement-agreement')).toContainText('Vereinbarung Schulmaterial');
    await expect(list.getByTestId('requirement-report')).toHaveAttribute('data-done', 'false');
    await expect(list.getByTestId('requirement-report').getByRole('button', { name: 'Hochladen oder verknüpfen' })).toBeVisible();

    await list.getByTestId('requirement-invoice').getByRole('button', { name: 'Hochladen oder verknüpfen' }).click();
    const form = page.getByTestId('evidence-form-invoice');
    await form.getByLabel('Nicht auf Deutsch').check();
    await form.getByLabel('Deutsche Erläuterung').fill('Schulranzen und Hefte für 60 Kinder');
    // V (Prüfer Block 2): eine Förderung verlangt keine betragsgenaue Deckung — kein Betragsfeld, kein Balken „Belegt“.
    await expect(form.getByLabel('Belegter Betrag')).toHaveCount(0);
    await form.getByTestId('voucher-file-input').setInputFiles(PDF);
    await form.getByRole('button', { name: 'Hochladen' }).click();
    await expect(list.getByTestId('requirement-invoice')).toHaveAttribute('data-done', 'true');
    await expect(list.getByTestId('requirement-invoice')).toContainText('Schulranzen und Hefte für 60 Kinder');
    await expect(page.getByTestId('evidence-coverage')).toHaveCount(0);
    // AL (Recheck sha-0170e73): der abgelegte Nachweis heißt nach seiner Art in Worten, nie mit dem Code — über die Oberfläche wie per MCP.
    await expect(list.getByTestId('requirement-invoice')).toContainText(/Rechnung oder Abrechnung vom \d{2}\.\d{2}\.\d{4}/);
    await expect(list.getByTestId('requirement-invoice')).not.toContainText('invoice');
    await callTool(client, 'finance_partner_evidence_upload', { paymentId: submitted.id, kind: 'report', fileName: 'bericht.pdf', contentBase64: PDF.buffer.toString('base64') });
    await page.reload();
    await expect(list.getByTestId('requirement-report')).toContainText(/Bericht vom \d{2}\.\d{2}\.\d{4}/);
    // W (Prüfer Block 2): der Nachweis nennt seine Nummer und führt auf das PDF.
    await expect(list.getByTestId('requirement-invoice').getByRole('link')).toHaveAttribute('href', /\/dms\/[0-9A-Z]{26}\/file$/);
    await expect(list.getByTestId('requirement-agreement').getByRole('link', { name: /Vereinbarung Schulmaterial|[A-Z]+-\d{4}-\d+/ })).toBeVisible();

    // Anna Berger hat den Vorgang angelegt — anerkennen kann nur jemand anderes.
    // AO (Recheck sha-0170e73): die Nummer steht je Nachweiszeile einmal — als Link, nicht zusätzlich im Text.
    const invoiceNumber = (await list.getByTestId('requirement-invoice').getByRole('link').textContent())!.trim();
    expect(invoiceNumber).toMatch(/^PNW-\d{4}-\d+$/);
    expect((await list.getByTestId('requirement-invoice').textContent())!.split(invoiceNumber)).toHaveLength(2);
    const ack = page.getByTestId('evidence-acknowledge-area');
    // AN: eine Förderung verlangt keine Betragsdeckung — der Satz der Voraussetzungen nennt sie nicht.
    await expect(ack).toContainText('Anerkennen geht, wenn alle Pflichtarten da sind');
    await expect(ack).not.toContainText('Betrag gedeckt');
    await expect(ack).toContainText('nie, wer den Vorgang angelegt hat');
    await expect(ack).toContainText('Das kann erledigen: Jonas Feld');
    await expect(page.getByTestId('evidence-acknowledge')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('U Rest (Recheck sha-0170e73): „bereit zum Anerkennen“ an der Zahlung und in der Liste — für die zweite Person, nie für die Anlegerin', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10) — nur für die Ausgangslage.
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Bereitschaft Inland e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody', usualBasis: 'transfer58' });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    await callTool(client, 'finance_entry_book', { entryDate: associationDay(), text: 'Förderung Bereitschaft', moneyLines: [{ accountId: bank.id, amountCents: -40000 }], allocationLines: [{ categoryId: category.id, amountCents: -40000, contactId: org.id }] });
    const paidLine = (await callTool<{ id: string }[]>(client, 'finance_partner_eligible_lines', { partnerId: partner.id, kind: 'paidLine' }))[0]!;
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'transfer58', purposeText: 'Bereitschaft', retroactive: true, positions: [], paidLineIds: [paidLine.id] });
    const submitted = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });
    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');
    await callTool(client, 'finance_partner_evidence_upload', { paymentId: submitted.id, kind: 'paymentProof', fileName: 'ueberweisung.pdf', contentBase64: PDF.buffer.toString('base64') });

    // Jonas Feld darf anerkennen: Kennzeichen in Worten in der Liste, Hinweis an der Zahlung.
    await page.goto(`/finance/partners/${partner.id}`);
    await expect(page.getByTestId(`payment-row-${submitted.id}`)).toContainText('bereit zum Anerkennen');
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    await expect(page.getByTestId('payment-ready-to-acknowledge')).toContainText('Bereit zum Anerkennen');
    await expect(page.getByTestId('evidence-acknowledge')).toBeVisible();

    // Anna Berger hat sie angelegt — für sie ist nichts bereit.
    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}`);
    await expect(page.getByTestId(`payment-row-${submitted.id}`)).toContainText('gezahlt');
    await expect(page.getByTestId(`payment-row-${submitted.id}`)).not.toContainText('bereit zum Anerkennen');
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    await expect(page.getByTestId('payment-detail')).toBeVisible();
    await expect(page.getByTestId('payment-ready-to-acknowledge')).toHaveCount(0);
  });

  test('Q Rest (Recheck sha-0170e73): sinkt der Zweck zwischen Einreichen und Freigabe, fragt die Freigabe vorab nach einer Begründung', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10) — nur für die Ausgangslage.
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Zweckbestand e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'publicBody' });
    const purpose = await callTool<{ id: string }>(client, 'finance_master_data_save', { kind: 'purpose', data: { name: 'Zweckbestand Q E2E' } });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const categories = await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' });
    const income = categories.find((c) => c.key === 'purpose-income')!;
    const costs = categories.find((c) => c.key === 'program-costs')!;
    await callTool(client, 'finance_entry_book', { entryDate: associationDay(), text: 'Zweckspende Q', moneyLines: [{ accountId: bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: income.id, amountCents: 5000, purposeId: purpose.id }] });
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: 4000, categoryId: costs.id, purposeId: purpose.id }] });
    const submitted = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });
    // Nach dem Einreichen gibt jemand 20 € aus dem Zweck aus — die Zahlung brächte ihn jetzt auf −10 €.
    await callTool(client, 'finance_entry_book', { entryDate: associationDay(), text: 'Ausgabe Q', moneyLines: [{ accountId: bank.id, amountCents: -2000 }], allocationLines: [{ categoryId: costs.id, amountCents: -2000, purposeId: purpose.id }] });

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    const prompt = page.getByTestId('purpose-reason');
    await expect(prompt).toBeVisible();
    await prompt.getByLabel('Begründung trotz Zweck im Minus').fill('Spenden sind angekündigt');
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');
    const payment = await callTool<{ purposeNegativeReason: string | null }>(client, 'finance_partner_payment_get', { id: submitted.id });
    expect(payment.purposeNegativeReason).toBe('Spenden sind angekündigt');
  });

  test('Freigabe-Detail ?payment= (3h/4b): gemeinsamer Rahmen, Pflichtnachweise statt Positionen, was danach passiert, Ablehnen im Dialog — auch bei „Zweck ändern“', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Auftragspartner Beispielland' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'foreignBody', usualBasis: 'agent57' });
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const order = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'auftrag.pdf', typeKey: 'minutes', subject: 'Auftrag Brunnenbau', documentDate: story('2026-02-01'), contentBase64: PDF.buffer.toString('base64') });
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'agent57', purposeText: 'Brunnenbau', agreementDocumentId: order.id, retroactive: false, positions: [{ kind: 'money', amountCents: 25000, categoryId: category.id }] });
    const submitted = await callTool<{ id: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });

    await switchToJonas(page);
    await page.goto('/finance/approvals');
    await expect(page.getByTestId('approval-queue-item').filter({ hasText: 'Auftragspartner Beispielland' })).toContainText('Zahlung an Partner');
    await expect(page.getByTestId('approval-queue-item').filter({ hasText: 'Zweck ändern' }).first()).toBeVisible();
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    const head = page.getByTestId('approval-head');
    await expect(head).toContainText('Zahlung an Partner');
    await expect(head).toContainText('250,00 €');
    await expect(head).toContainText('Auftragspartner Beispielland');
    await expect(page.getByTestId('partner-payment-basis')).toContainText('Auftrag an einen Partner');
    const requirements = page.getByTestId('partner-payment-requirements');
    await expect(requirements.getByTestId('requirement-agreement')).toHaveAttribute('data-done', 'true');
    await expect(requirements).toContainText('Auftrag je Vorhaben');
    await expect(requirements).toContainText('Freigabe nur mit dem Auftrag.');
    const footer = page.getByTestId('approval-footer');
    await expect(footer).toHaveCSS('position', 'sticky');
    await expect(footer).toContainText('Nach der Freigabe entsteht eine offene Zahlung an Auftragspartner Beispielland über 250,00 €');

    await page.getByTestId('partner-payment-reject').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Den Grund liest');
    await dialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Bitte nennen Sie den Grund.');
    await dialog.getByLabel('Grund').fill('Auftrag bitte mit Kostenplan');
    await dialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Abgelehnt');

    // Die wartende Umwidmung aus den Entwicklungsdaten: dieselbe Ablehnung im Dialog.
    await page.goto('/finance/approvals');
    await page.getByTestId('approval-queue-item').filter({ hasText: 'Zweck ändern' }).first().click();
    await page.getByTestId('purpose-transfer-reject').click();
    const transferDialog = page.getByRole('dialog');
    await transferDialog.getByLabel('Grund').fill('Beschluss fehlt noch');
    await transferDialog.getByRole('button', { name: 'Ablehnen' }).click();
    await expect(page.getByTestId('purpose-transfer-result')).toContainText('Abgelehnt');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('E1 (4a): Liste als Tabelle, Angaben zweispaltig mit Karten für die Art, Frist in Monaten, Rechtsform vom Kontakt, Anerkennung im Sitzland', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Partnerorganisation Tabelle', legalForm: 'Stiftung nach örtlichem Recht' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'foreignBody', usualBasis: 'agent57' });
    const anerkennung = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'anerkennung.pdf', typeKey: 'minutes', subject: 'Anerkennung Sitzland', documentDate: story('2026-02-04'), contentBase64: PDF.buffer.toString('base64') });

    await page.goto('/finance/partners');
    const table = page.getByRole('table');
    for (const column of ['Partner', 'Status', 'übliche Art', 'offene Nachweise', 'zuletzt gezahlt']) await expect(table.getByRole('columnheader', { name: column })).toBeVisible();
    const row = table.getByRole('row').filter({ hasText: 'Partnerorganisation Tabelle' });
    await expect(row).toContainText('Organisation im Ausland');
    await expect(row).toContainText('Auftrag');
    await expect(page.getByRole('link', { name: 'Partner anlegen' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });

    await row.getByRole('link', { name: 'Partnerorganisation Tabelle' }).click();
    const profile = page.getByTestId('partner-profile');
    await expect(profile).toContainText('Stiftung nach örtlichem Recht');
    const payments = page.getByTestId('partner-payments');
    const left = (await profile.boundingBox())!;
    const right = (await payments.boundingBox())!;
    expect(right.x).toBeGreaterThan(left.x + left.width - 1);

    const cards = page.getByRole('radiogroup', { name: 'Wie arbeitet der Partner mit Ihrem Geld?' });
    await expect(cards.getByRole('radio', { name: /Er handelt in unserem Auftrag/ })).toBeChecked();
    await cards.getByRole('radio', { name: /Der Partner entscheidet selbst/ }).check();
    await expect(profile).toContainText('Bei Organisationen im Ausland Pflicht.');
    await page.getByLabel('Übliche Nachweisfrist').selectOption('6');
    await page.getByTestId('partner-profile-save').click();
    await expect.poll(async () => (await callTool<{ usualProofMonths: number; usualBasis: string }>(client, 'finance_partner_get', { id: partner.id })).usualProofMonths).toBe(6);
    expect((await callTool<{ usualBasis: string }>(client, 'finance_partner_get', { id: partner.id })).usualBasis).toBe('transfer58');

    const notices = page.getByTestId('partner-notices');
    await notices.getByRole('button', { name: 'Bescheid erfassen' }).click();
    await page.getByLabel('Art', { exact: true }).selectOption({ label: 'Anerkennung im Sitzland' });
    await page.getByLabel('Datum des Bescheids').fill(story('2025-12-01'));
    await page.getByLabel('gültig bis').fill(story('2027-12-31'));
    await page.getByLabel('Eingegangen am').fill(story('2026-02-04'));
    await page.getByRole('combobox', { name: 'Dokument' }).fill('Anerkennung Sitzland');
    await page.getByRole('option', { name: /Anerkennung Sitzland/ }).click();
    await notices.getByRole('button', { name: 'Speichern' }).click();
    const noticeRow = notices.getByRole('row').filter({ hasText: 'Anerkennung im Sitzland' });
    await expect(noticeRow).toContainText(story('31.12.2027'));
    await expect(noticeRow).toContainText(story('04.02.2026'));
    void anerkennung;

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('Kacheln (4g, Entscheidung 8): standardmäßig an, mit „Finanzen lesen“ Zeilen mit Nummer und Betrag, ohne nur Anzahl und Summe', async ({ page, baseURL }) => {
    const client = await mcpClient(page, baseURL);
    await callTool(client, 'dashboard_reset_layout', {});
    await page.goto('/');
    const tile = page.getByTestId('dashboard-tile-finance-partnerPaymentsWithoutProof');
    // Aus den Entwicklungsdaten: „Nothilfe Erdbebenregion“ ist freigegeben, der Nachweis fehlt.
    await expect(tile).toContainText('Hilfswerk International e.V. · PZ-');
    await expect(tile).toContainText('1.200,00 €');
    await expect(page.getByTestId('dashboard-tile-finance-purposesNegative')).toBeVisible();

    const role = await callTool<{ id: string }>(client, 'roles_create', { name: 'Finanzen Überblick E2E' });
    await callTool(client, 'roles_set_permissions', { roleId: role.id, permissionKeys: ['finance.overview'] });
    const users = await callTool<{ id: string; email: string }[]>(client, 'users_list', {});
    await callTool(client, 'roles_assign', { userId: users.find((u) => u.email === 'peter@kompass.local')!.id, roleId: role.id });
    await switchTo(page, 'Peter Lang', 'peter@kompass.local');
    await page.goto('/');
    const overview = page.getByTestId('dashboard-tile-finance-partnerPaymentsWithoutProof');
    await expect(overview).toContainText('an Partner ohne anerkannten Nachweis, zusammen');
    await expect(overview).not.toContainText('Hilfswerk International');
    await expect(overview).not.toContainText('PZ-');
  });
  test('Baustein 16 beim Auftrag (V): „Belegt · x von y · Rest“ nur, wo die Art eine Betragsdeckung verlangt', async ({ page, baseURL }) => {
    await setE2ESetting(page, 'finance.mcpHumanOnlyAllowed', true); // `finance_entry_book` ist humanOnly (E10) — nur für die Ausgangslage.
    const client = await mcpClient(page, baseURL);
    const org = await callTool<{ id: string }>(client, 'contacts_create', { kind: 'organization', name: 'Auftragsdeckung e.V.' });
    const partner = await callTool<{ id: string }>(client, 'finance_partner_save', { contactId: org.id, status: 'agent' });
    const bank = (await callTool<{ id: string; isMain?: boolean }[]>(client, 'finance_master_data', { kind: 'account' })).find((a) => a.isMain) as { id: string };
    const category = (await callTool<{ id: string; key: string }[]>(client, 'finance_master_data', { kind: 'category' })).find((c) => c.key === 'program-costs')!;
    const order = await callTool<{ id: string }>(client, 'dms_receive', { filename: 'auftrag.pdf', typeKey: 'minutes', subject: 'Auftrag Futterverteilung', documentDate: story('2026-02-01'), contentBase64: PDF.buffer.toString('base64') });
    await callTool(client, 'finance_entry_book', { entryDate: associationDay(), text: 'Auftrag Futterverteilung', moneyLines: [{ accountId: bank.id, amountCents: -25000 }], allocationLines: [{ categoryId: category.id, amountCents: -25000, contactId: org.id }] });
    const paidLine = (await callTool<{ id: string }[]>(client, 'finance_partner_eligible_lines', { partnerId: partner.id, kind: 'paidLine' }))[0]!;
    const draft = await callTool<{ id: string; version: string }>(client, 'finance_partner_payment_draft_save', { partnerId: partner.id, basis: 'agent57', purposeText: 'Futterverteilung', agreementDocumentId: order.id, retroactive: true, positions: [], paidLineIds: [paidLine.id] });
    const submitted = await callTool<{ id: string }>(client, 'finance_partner_payment_submit', { id: draft.id, expectedVersion: draft.version });

    await switchToJonas(page);
    await page.goto(`/finance/approvals?payment=${submitted.id}`);
    await page.getByTestId('partner-payment-approve').click();
    await expect(page.getByTestId('partner-payment-result')).toContainText('Freigegeben');

    await backToAdmin(page);
    await page.goto(`/finance/partners/${partner.id}/payments/${submitted.id}`);
    const list = page.getByTestId('evidence-requirements');
    await expect(list.getByTestId('requirement-agreement')).toContainText('Auftrag je Vorhaben');
    await list.getByTestId('requirement-settlement').getByRole('button', { name: 'Hochladen oder verknüpfen' }).click();
    const form = page.getByTestId('evidence-form-settlement');
    await form.getByLabel('Belegter Betrag').fill('100,00');
    await form.getByTestId('voucher-file-input').setInputFiles(PDF);
    await form.getByRole('button', { name: 'Hochladen' }).click();
    const coverage = page.getByTestId('evidence-coverage');
    await expect(coverage).toHaveAttribute('aria-live', 'polite');
    await expect(coverage).toContainText('100,00 € von 250,00 €');
    await expect(coverage).toContainText('150,00 € noch nicht belegt');
    // AN (Recheck sha-0170e73): beim Auftrag gehört die Betragsdeckung zu den Voraussetzungen.
    await expect(page.getByTestId('evidence-acknowledge-area')).toContainText('und der Betrag gedeckt ist');
  });
});
