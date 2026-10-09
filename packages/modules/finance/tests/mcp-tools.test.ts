import { readFileSync } from 'node:fs';
import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { insertRaw, insertRun, ledgerFixture, pdfBytes } from './helpers';
import { donationFixture, png } from './donation-fixture';
import { buildCamt053 } from '../src/import/camt-fixture';

describe('finance MCP tools', () => {
  // W2 (Architektur-Review A3): kein Werkzeug nimmt ein freies Objekt — es zeigt das Schema des Dienstes.
  it('offers no free-form object in any tool schema', () => {
    const source = readFileSync(new URL('../src/mcp-tools.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/z\.record\(\s*z\.string\(\)\s*,\s*z\.unknown\(\)\s*\)/);
  });


  // M11: `kind` steht auf oberster Ebene als Aufzählung; die Felder je Art stehen eine Ebene tiefer. Das SDK parst die
  // Argumente mit diesem Schema, bevor der Dienst sie sieht — es darf nichts abstreifen und keinen Vorgabewert
  // einschleusen (ein `isMain: false` in der Änderung eines Kontos nähme ihm die Hauptkonto-Rolle).
  it('passes master data of every kind through its MCP schema unchanged (M11)', () => {
    const schema = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!.inputSchema as import('zod').ZodType;
    const save = [
      { kind: 'purpose', data: { name: 'Zweck', targetCents: 5000 } },
      { kind: 'account', data: { id: 'A1', name: 'Neu', expectedVersion: 'v1' } },
      { kind: 'category', data: { name: 'Kat', sphere: 'ideal', direction: 'expense' } },
      { kind: 'account', data: { name: 'Konto', kind: 'bank', iban: 'DE12999999990000112233' } },
      { kind: 'purpose', data: { id: 'P1', isActive: false } },
    ];
    for (const input of save) expect(schema('finance_master_data_save').parse(input), JSON.stringify(input)).toEqual(input);
    for (const kind of ['account', 'category', 'purpose', 'fiscalYear', 'datedValue']) expect(schema('finance_master_data').parse({ kind })).toEqual({ kind });
  });

  it('every human-only tool says so, and answers an agent with the way out', async () => {
    const f = await ledgerFixture();
    const humanOnly = ['finance_entry_review', 'finance_entry_finalize', 'finance_entries_finalize_reviewed', 'finance_entry_book', 'finance_entry_reverse', 'finance_voucher_revoke', 'finance_correction_request', 'finance_correction_decide', 'finance_period_close', 'finance_period_reopen', 'finance_reserve_movement_record'];
    for (const name of humanOnly) expect(FINANCE_MCP_TOOLS.find((t) => t.name === name)!.description, name).toMatch(/Human only/);

    const agent = { ...f.ctx, channel: 'mcp' as const };
    const BALANCED = { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] };
    const res = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_entry_book')!.handler(f.deps, agent, BALANCED);
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    // Befund 13 (Spec 10.2): Grund und Abhilfe statt des rohen Einstellungsschlüssels "finance.mcpHumanOnlyAllowed".
    if (!res.ok && res.error.type === 'conflict') {
      // A6: der Text kommt aus der Sprachdatei (`apps/kompass/tests/finance-error-messages.test.ts`).
      expect(res.error.messageKey).toBe('finance.errors.humanOnly');
    }

    const revokeRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_revoke')!.handler(f.deps, agent, { linkId: 'x', note: 'x' });
    expect(revokeRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const requestRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_correction_request')!.handler(f.deps, agent, { lineId: 'x', changes: {}, note: 'x' });
    expect(requestRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const decideRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_correction_decide')!.handler(f.deps, agent, { id: 'x', decision: 'approve' });
    expect(decideRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
  });

  it('the notice tool requires the start of the exemption; issuing and starting a run take no reason (N4)', () => {
    const find = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
    const shape = (name: string) => (find(name).inputSchema as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
    expect(Object.keys(shape('finance_notice_save'))).toContain('exemptFrom');
    expect(shape('finance_notice_save').exemptFrom!.safeParse(undefined).success).toBe(false);
    expect(find('finance_notice_save').description).toMatch(/start of the tax exemption/);
    expect(Object.keys(shape('finance_confirmation_issue'))).not.toContain('preNoticeReason');
    expect(Object.keys(shape('finance_confirmation_run_start'))).not.toContain('preNoticeReason');
  });

  it('registers nine new tools for vouchers, open items and the allocation correction', () => {
    const names = [
      'finance_voucher_upload', 'finance_voucher_attach', 'finance_voucher_revoke',
      'finance_open_item_save', 'finance_open_item_cancel', 'finance_open_items_list',
      'finance_correction_request', 'finance_correction_decide', 'finance_corrections_list',
    ];
    for (const name of names) expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
  });

  it('registers the year-close tools: preview dispatches by action, close and reopen refuse an agent, justify needs finance.periodClose', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    for (const name of ['finance_period_preview', 'finance_period_close', 'finance_period_reopen', 'finance_entry_justify']) {
      expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
    }
    expect(FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_reopen')!.description).toMatch(/allocation correction|correction in the current year/);

    const previewTool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_preview')!;
    const closePreview = unwrap(await previewTool.handler(f.deps, f.ctx, { id: f.years['2025']!.id, action: 'close' }));
    expect(closePreview).toHaveProperty('canClose');
    f.closeYear(f.years['2025']!.id);
    const reopenPreview = unwrap(await previewTool.handler(f.deps, f.ctx, { id: f.years['2025']!.id, action: 'reopen' }));
    expect(reopenPreview).toHaveProperty('laterYearClosed');

    const agent = { ...f.ctx, channel: 'mcp' as const };
    const closeRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_close')!.handler(f.deps, agent, { id: f.years['2025']!.id });
    expect(closeRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    const reopenRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_reopen')!.handler(f.deps, agent, { id: f.years['2025']!.id, note: 'x' });
    expect(reopenRes).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

    const justifyRes = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_entry_justify')!.handler(f.deps, { ...f.ctx, permissions: new Set(['finance.read']) }, { entryId: 'x', note: 'x' });
    expect(justifyRes).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.periodClose' } });
  });

  it('finance_voucher_upload rejects a file over the association’s upload limit', async () => {
    const f = await ledgerFixture();
    const entry = await f.finalEntry();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_upload')!;
    // Vorgabe finance.uploadLimitMb = 5 MB; 6 MB Rohdaten (roh, vor Base64) liegen darüber.
    const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
    const res = await tool.handler(f.deps, f.ctx, { entryId: entry.id, contentBase64: big, typeKey: 'voucher-invoice', documentDate: '2026-03-01' });
    expect(res).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('registers the work list tools (F5); an argument-less tool takes (deps, ctx), the counts take an account', async () => {
    const names = [
      'finance_work_list', 'finance_work_counts', 'finance_suggestion_get', 'finance_transaction_book', 'finance_transaction_link_entry', 'finance_transaction_mark_foreign',
      'finance_foreign_money_list', 'finance_import_rule_save', 'finance_import_rules_list', 'finance_import_rule_delete', 'finance_import_rule_preview',
      'finance_contact_iban_link', 'finance_contact_iban_unlink', 'finance_contact_ibans_list', 'finance_contact_create_from_transaction',
      'finance_batch_finalize_preview', 'finance_voucher_search', 'finance_voucher_upload_to_transaction', 'finance_vouchers_without_entry',
      'finance_raw_transaction_get',
    ];
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
    for (const name of names) expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
    expect(tool('finance_foreign_money_list').handler.length).toBe(2);
    // Seit den Filterleisten (0.2.9) nimmt die Zählung ein Konto wie die Liste.
    expect(tool('finance_work_counts').handler.length).toBe(3);
    expect(tool('finance_transaction_book').description).toMatch(/reviewed:true is human only/);
    expect(tool('finance_transaction_mark_foreign').description).toMatch(/reviewed:true is human only/);
    expect(tool('finance_contact_create_from_transaction').description).toContain('contacts.manage');

    const f = await ledgerFixture();
    expect(unwrap(await tool('finance_work_counts').handler(f.deps, f.ctx, {}))).toMatchObject({ open: 0, unsure: 0 });
    expect(unwrap(await tool('finance_foreign_money_list').handler(f.deps, f.ctx, {}))).toEqual({ items: [] });

    // Ein Agent legt vor, prüft aber nicht.
    const agent = { ...f.ctx, channel: 'mcp' as const };
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990 });
    const book = tool('finance_transaction_book');
    const input = { rawTransactionId: rawId, text: 'Büromaterial', allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1990 }] };
    expect(await book.handler(f.deps, agent, { ...input, reviewed: true })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    expect((await book.handler(f.deps, agent, { ...input, reviewed: false })).ok).toBe(true);
  });

  it('finance_voucher_upload_to_transaction takes base64 and the upload limit like finance_voucher_upload', async () => {
    const f = await ledgerFixture();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_upload_to_transaction')!;
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990 });
    expect(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
    expect(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: big })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const res = unwrap(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: Buffer.from(pdfBytes()).toString('base64') }));
    expect(res).toMatchObject({ createdEntry: true });
  });

  describe('donations (F6a)', () => {
    const DONATION_TOOLS = {
      finance_notice_save: 'finance.donationsIssue',
      finance_notice_supersede: 'finance.donationsIssue',
      finance_notice_void: 'finance.donationsIssue',
      finance_notices_list: 'finance.read',
      finance_notice_attach_document: 'finance.donationsIssue',
      finance_signer_save: 'finance.donationsIssue',
      finance_facsimile_upload: 'finance.donationsIssue',
      finance_machine_procedure_get: 'finance.read',
      finance_notification_letter_draft: 'finance.donationsIssue',
      finance_confirmation_check: 'finance.read',
      finance_confirmation_issue: 'finance.donationsIssue',
      finance_confirmation_void: 'finance.donationsIssue',
      finance_confirmation_dispatch: 'finance.donationsIssue',
      finance_confirmation_attach_signed: 'finance.donationsIssue',
      finance_confirmations_list: 'finance.read',
      finance_donations_uncertified: 'finance.read',
      finance_in_kind_details_save: 'finance.entriesWrite',
      finance_in_kind_details_get: 'finance.read',
    } as const;
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

    it('registers eighteen donation tools, each naming its permission; the argument-less one takes (deps, ctx)', () => {
      for (const [name, permission] of Object.entries(DONATION_TOOLS)) {
        expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
        expect(tool(name).description, name).toContain(permission);
        expect(tool(name).description, name).toMatch(/^[\x20-\x7e]+$/);
      }
      expect(tool('finance_machine_procedure_get').handler.length).toBe(2);
      expect(tool('finance_notification_letter_draft').description).toContain('dms.create');
    });

    it('issue and void are human only and answer an agent with the way out', async () => {
      const f = await donationFixture();
      const { line } = await f.donate();
      for (const name of ['finance_confirmation_issue', 'finance_confirmation_void']) expect(tool(name).description, name).toMatch(/Human only/);
      const agent = { ...f.ctx, channel: 'mcp' as const };
      expect(await tool('finance_confirmation_issue').handler(f.deps, agent, { lineIds: [line.id] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
      expect(await tool('finance_confirmation_void').handler(f.deps, agent, { id: 'x', note: 'x', alreadySent: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
      // Lesen und prüfen darf ein Agent.
      expect(unwrap(await tool('finance_confirmation_check').handler(f.deps, agent, { lineIds: [line.id] }))).toMatchObject({ ok: true, kind: 'money' });
      expect(unwrap(await tool('finance_donations_uncertified').handler(f.deps, agent, {}))).toMatchObject({ total: 1 });
    });

    it('finance_facsimile_upload takes base64, never returns the bytes and says so', async () => {
      const f = await donationFixture();
      const upload = tool('finance_facsimile_upload');
      expect(upload.description).toMatch(/bytes are never returned/);
      const signer = unwrap(await tool('finance_signer_save').handler(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' })) as { id: string };
      expect(await upload.handler(f.deps, f.ctx, { signerId: signer.id, contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
      const view = unwrap(await upload.handler(f.deps, f.ctx, { signerId: signer.id, contentBase64: Buffer.from(png()).toString('base64') }));
      expect(view).toMatchObject({ id: signer.id, hasFacsimile: true });
      expect(JSON.stringify(view)).not.toMatch(/bytes/);
      expect(unwrap(await tool('finance_machine_procedure_get').handler(f.deps, f.ctx, {}))).toMatchObject({ status: { complete: false, missing: ['notifiedOn'] } });
    });

    it('finance_notice_attach_document takes base64 within the upload limit', async () => {
      const f = await donationFixture();
      const attach = tool('finance_notice_attach_document');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
      const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: big })).toMatchObject({ ok: false, error: { type: 'validation' } });
      expect(await attach.handler(f.deps, f.ctx, { id: 'nope', contentBase64: Buffer.from(pdfBytes()).toString('base64') })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    });

    it('finance_confirmation_attach_signed takes base64 within the upload limit', async () => {
      const f = await donationFixture();
      const attach = tool('finance_confirmation_attach_signed');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
      const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: big })).toMatchObject({ ok: false, error: { type: 'validation' } });
      expect(await attach.handler(f.deps, f.ctx, { id: 'nope', contentBase64: Buffer.from(pdfBytes()).toString('base64') })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    });
  });

  describe('confirmation runs and donation book (F6b)', () => {
    const RUN_TOOLS = {
      finance_confirmation_run_preview: 'finance.read',
      finance_confirmation_run_start: 'finance.donationsIssue',
      finance_confirmation_run_continue: 'finance.donationsIssue',
      finance_confirmation_run_get: 'finance.read',
      finance_confirmation_runs_list: 'finance.read',
      finance_confirmation_run_dispatch: 'finance.donationsIssue',
      finance_donation_book: 'finance.read',
      finance_donation_reconciliation: 'finance.read',
    } as const;
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

    it('registers eight tools, each naming its permission; start and continue say human only, continue takes max', () => {
      for (const [name, permission] of Object.entries(RUN_TOOLS)) {
        expect(FINANCE_MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
        expect(tool(name).description, name).toContain(permission);
        expect(tool(name).description, name).toMatch(/^[\x20-\x7e]+$/);
      }
      for (const name of ['finance_confirmation_run_start', 'finance_confirmation_run_continue']) expect(tool(name).description, name).toMatch(/Human only/);
      for (const name of ['finance_confirmation_run_preview', 'finance_confirmation_run_get', 'finance_confirmation_runs_list', 'finance_confirmation_run_dispatch', 'finance_donation_book', 'finance_donation_reconciliation']) {
        expect(tool(name).description, name).not.toMatch(/Human only/);
      }
      expect(Object.keys((tool('finance_confirmation_run_continue').inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(['runId', 'max']);
    });

    it('refuses an agent to start or continue a run, lets it preview, read the runs, the book and the reconciliation', async () => {
      const f = await donationFixture();
      await f.donate({ date: '2026-02-01', cents: 5000 });
      const agent = { ...f.ctx, channel: 'mcp' as const };
      expect(await tool('finance_confirmation_run_start').handler(f.deps, agent, { year: 2026 })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
      expect(await tool('finance_confirmation_run_continue').handler(f.deps, agent, { runId: 'x', max: 5 })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });

      expect(unwrap(await tool('finance_confirmation_run_preview').handler(f.deps, agent, { year: 2026 }))).toMatchObject({ counts: { ready: 0, needsSignature: 1 } });
      const run = unwrap(await tool('finance_confirmation_run_start').handler(f.deps, f.ctx, { year: 2026 })) as { id: string };
      unwrap(await tool('finance_confirmation_run_continue').handler(f.deps, f.ctx, { runId: run.id, max: 5 }));
      expect(unwrap(await tool('finance_confirmation_run_get').handler(f.deps, agent, { id: run.id }))).toMatchObject({ id: run.id, counts: { issued: 1, pending: 0 } });
      expect(unwrap(await tool('finance_confirmation_runs_list').handler(f.deps, agent, {}))).toMatchObject({ total: 1 });
      expect(unwrap(await tool('finance_donation_book').handler(f.deps, agent, { year: 2026 }))).toMatchObject({ total: 1, sums: { total: 5000 } });
      expect(unwrap(await tool('finance_donation_reconciliation').handler(f.deps, agent, { year: 2026 }))).toMatchObject({ donationsCents: 5000, confirmedCents: 5000, differenceCents: 0 });
      // Der Versandvermerk für alle ist kein Ausstellen — ein Agent darf ihn setzen, nur maschinelle zählen.
      expect(await tool('finance_confirmation_run_dispatch').handler(f.deps, agent, { runId: run.id, sentAt: '2026-03-20', sentVia: 'post' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'dispatchNothingMachine' } });
    });
  });

  it('finance_statement_detect_account takes base64 like finance_import_statement and names both ibans of a file for two accounts (N3, W-1)', async () => {
    const f = await ledgerFixture();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_statement_detect_account')!;
    expect(tool.description).toContain('finance.entriesWrite');
    expect(tool.description).toMatch(/^[\x20-\x7e]+$/);
    expect(await tool.handler(f.deps, f.ctx, { fileName: 'a.xml', contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });

    const camt = (iban: string) => buildCamt053({ iban, from: '2026-03-01', to: '2026-03-31', openingCents: 0, lines: [] });
    const own = Buffer.from(camt('DE23999999990000202051')).toString('base64');
    expect(unwrap(await tool.handler(f.deps, f.ctx, { fileName: 'a.xml', contentBase64: own }))).toEqual({ kind: 'one', format: 'camt053', accountId: f.bank.id });

    const first = camt('DE23999999990000202051');
    const second = camt('DE12999999990000606060');
    const two = first.replace('</Stmt>', `</Stmt>${second.slice(second.indexOf('<Stmt>'), second.indexOf('</Stmt>') + 7)}`);
    const res = await tool.handler(f.deps, f.ctx, { fileName: 'q1.xml', contentBase64: Buffer.from(two).toString('base64') });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementMultipleAccounts', params: { ibans: expect.stringMatching(/DE23 9999.*DE12 9999/) } } });
  });
});
