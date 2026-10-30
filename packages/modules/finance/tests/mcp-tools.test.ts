import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { REPORT_CATALOG } from '../src/reporting/catalog';
import { allowHumanOnlyOverMcp, insertRaw, insertRun, ledgerFixture, pdfBytes } from './helpers';
import { donationFixture, png } from './donation-fixture';
import { buildCamt053 } from '../src/import/camt-fixture';
import { setDatedValue } from '../src/ledger/dated-values';
import { bookEntry } from '../src/ledger/finalize';

describe('finance MCP tools', () => {
  // W2 (Architektur-Review A3): kein Werkzeug nimmt ein freies Objekt — es zeigt das Schema des Dienstes.
  it('offers no free-form object in any tool schema', () => {
    const source = readFileSync(new URL('../src/mcp-tools.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/z\.record\(\s*z\.string\(\)\s*,\s*z\.unknown\(\)\s*\)/);
  });


  // Rechenschaft B1: kein Werkzeug je Bericht — `finance_report` trägt alle; seine Beschreibung nennt jeden verfügbaren
  // Schlüssel des Katalogs, sonst fände ein Agent ihn nicht.
  it('names every available report of the catalogue in finance_report', () => {
    const description = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_report')!.description;
    const available = REPORT_CATALOG.filter((d) => d.available).map((d) => d.key);
    expect(available.length).toBeGreaterThan(4);
    for (const key of available) expect(description, key).toMatch(new RegExp(`\\b${key}\\b`));
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

  it('a refused agent learns why and what to do (Befund 13)', async () => {
    const f = await ledgerFixture();
    const agent = { ...f.ctx, channel: 'mcp' as const };
    const BALANCED = { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] };
    const res = await FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_entry_book')!.handler(f.deps, agent, BALANCED);
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    // Befund 13 (Spec 10.2): Grund und Abhilfe statt des rohen Einstellungsschlüssels "finance.mcpHumanOnlyAllowed".
    if (!res.ok && res.error.type === 'conflict') {
      // A6: der Text kommt aus der Sprachdatei (`apps/kompass/tests/finance-error-messages.test.ts`).
      expect(res.error.messageKey).toBe('finance.errors.humanOnly');
    }
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

  it('the year-close preview dispatches by action, justify needs finance.periodClose', async () => {
    const f = await ledgerFixture({ years: ['2025'] });
    expect(FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_reopen')!.description).toMatch(/allocation correction|correction in the current year/);

    const previewTool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_period_preview')!;
    const closePreview = unwrap(await previewTool.handler(f.deps, f.ctx, { id: f.years['2025']!.id, action: 'close' }));
    expect(closePreview).toHaveProperty('canClose');
    f.closeYear(f.years['2025']!.id);
    const reopenPreview = unwrap(await previewTool.handler(f.deps, f.ctx, { id: f.years['2025']!.id, action: 'reopen' }));
    expect(reopenPreview).toHaveProperty('laterYearClosed');

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
    // K3 (0.4.5): die Grenze prüft der Dienst — dieselbe Ablehnung wie auf der Oberfläche.
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementTooLarge' } });
  });

  it('the work list tools: an argument-less tool takes (deps, ctx), the counts take an account', async () => {
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
    expect(tool('finance_foreign_money_list').handler.length).toBe(2);
    // Seit den Filterleisten (0.2.9) nimmt die Zählung ein Konto wie die Liste.
    expect(tool('finance_work_counts').handler.length).toBe(3);
    expect(tool('finance_contact_create_from_transaction').description).toContain('contacts.manage');

    const f = await ledgerFixture();
    expect(unwrap(await tool('finance_work_counts').handler(f.deps, f.ctx, {}))).toMatchObject({ open: 0, unsure: 0 });
    expect(unwrap(await tool('finance_foreign_money_list').handler(f.deps, f.ctx, {}))).toEqual({ items: [] });
  });

  it('finance_voucher_upload_to_transaction takes base64 and the upload limit like finance_voucher_upload', async () => {
    const f = await ledgerFixture();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_voucher_upload_to_transaction')!;
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: -1990 });
    expect(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
    expect(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: big })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementTooLarge' } });
    const res = unwrap(await tool.handler(f.deps, f.ctx, { rawTransactionId: rawId, contentBase64: Buffer.from(pdfBytes()).toString('base64') }));
    expect(res).toMatchObject({ createdEntry: true });
  });

  describe('donations (F6a)', () => {
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

    it('the argument-less donation tool takes (deps, ctx); the letter names dms.create', () => {
      expect(tool('finance_machine_procedure_get').handler.length).toBe(2);
      expect(tool('finance_notification_letter_draft').description).toContain('dms.create');
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
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: big })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementTooLarge' } });
      expect(await attach.handler(f.deps, f.ctx, { id: 'nope', contentBase64: Buffer.from(pdfBytes()).toString('base64') })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    });

    it('finance_confirmation_attach_signed takes base64 within the upload limit', async () => {
      const f = await donationFixture();
      const attach = tool('finance_confirmation_attach_signed');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });
      const big = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
      expect(await attach.handler(f.deps, f.ctx, { id: 'x', contentBase64: big })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementTooLarge' } });
      expect(await attach.handler(f.deps, f.ctx, { id: 'nope', contentBase64: Buffer.from(pdfBytes()).toString('base64') })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    });
  });

  describe('confirmation runs and donation book (F6b)', () => {
    const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

    it('continue takes max', () => {
      expect(Object.keys((tool('finance_confirmation_run_continue').inputSchema as unknown as { shape: Record<string, unknown> }).shape)).toEqual(['runId', 'max']);
    });

    it('lets an agent preview, read the runs, the book and the reconciliation', async () => {
      const f = await donationFixture();
      await f.donate({ date: '2026-02-01', cents: 5000 });
      const agent = { ...f.ctx, channel: 'mcp' as const };

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
    expect(await tool.handler(f.deps, f.ctx, { fileName: 'a.xml', contentBase64: 'kein base64!' })).toMatchObject({ ok: false, error: { type: 'validation' } });

    const camt = (iban: string) => buildCamt053({ iban, from: '2026-03-01', to: '2026-03-31', openingCents: 0, lines: [] });
    const own = Buffer.from(camt('DE23999999990000202051')).toString('base64');
    expect(unwrap(await tool.handler(f.deps, f.ctx, { fileName: 'a.xml', contentBase64: own }))).toEqual({ kind: 'one', format: 'camt053', accountId: f.bank.id });

    const first = camt('DE23999999990000202051');
    const second = camt('DE12999999990000606060');
    const two = first.replace('</Stmt>', `</Stmt>${second.slice(second.indexOf('<Stmt>'), second.indexOf('</Stmt>') + 7)}`);
    const res = await tool.handler(f.deps, f.ctx, { fileName: 'q1.xml', contentBase64: Buffer.from(two).toString('base64') });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statementMultipleAccounts', params: { ibans: expect.stringMatching(/^DE23999999990000202051, DE12999999990000606060$/) } } });
  });
});

/**
 * „Nur für Menschen“ aus dem Quelltext abgeleitet (Testdurchsicht 2026-10-22, Plan P4 Task 2), statt einer Liste von
 * Werkzeugnamen je Bereich: Ein Dienst ist es, wenn er `requireHumanChannelFinance` ruft — selbst oder über eine
 * Funktion, die er ruft. Sein Werkzeug sagt es in der Beschreibung, und umgekehrt sagt es keines, dessen Dienst es nicht
 * ist. Ruft der Dienst die Prüfung gleich nach dem Recht (nicht erst je nach Eingabe), weist das Werkzeug einen Agenten
 * mit allen Rechten ab, ehe es die Eingabe ansieht.
 */
describe('human-only tools, derived from the services', () => {
  const SRC = path.resolve(import.meta.dirname, '../src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  /** Je Funktion im Modul ihr Quelltext bis zur nächsten Funktion auf oberster Ebene. */
  const bodies = new Map<string, string>();
  for (const file of files(SRC).filter((f) => f.endsWith('.ts'))) {
    for (const part of readFileSync(file, 'utf8').split(/\n(?=(?:export )?(?:async )?function )/)) {
      const name = /^(?:export )?(?:async )?function (\w+)/.exec(part)?.[1];
      if (name && name !== 'requireHumanChannelFinance') bodies.set(name, part);
    }
  }
  /** Ruft die Prüfung auf oberster Ebene des Rumpfs, also unabhängig von der Eingabe. */
  const always = (name: string) => /\n {2}const \w+ = requireHumanChannelFinance\(/.test(bodies.get(name) ?? '');
  /** Je Funktion die Funktionen, die sie ruft — einmal berechnet; die Suche lief sonst je Werkzeug über alle Rümpfe (unter Last über 5 s). */
  const callees = new Map([...bodies].map(([name, body]) => [name, [...bodies.keys()].filter((other) => other !== name && body.includes(`${other}(`) && new RegExp(`\\b${other}\\(`).test(body))]));
  const reaches = (name: string, seen = new Set<string>()): boolean => {
    const body = bodies.get(name);
    if (!body || seen.has(name)) return false;
    seen.add(name);
    if (body.includes('requireHumanChannelFinance(')) return true;
    return (callees.get(name) ?? []).some((other) => reaches(other, seen));
  };
  const MARKER = /human only: refused over MCP/i;
  /** Werkzeuge, deren Dienst die Prüfung zwar erreicht, aber nie auslöst — mit Grund. */
  const REACHES_BUT_NEVER_REFUSES: Record<string, string> = {
    finance_voucher_upload_to_transaction: 'Legt den Entwurf über bookFromTransaction an, aber immer mit reviewed: false — die Prüfung greift dort nur für reviewed: true.',
  };
  const serviceOf = (tool: (typeof FINANCE_MCP_TOOLS)[number]) => (tool.service as { name?: string } | undefined)?.name ?? '';

  it('finds the services that check the channel', () => {
    expect([...bodies.keys()].filter((name) => bodies.get(name)!.includes('requireHumanChannelFinance(')).length).toBeGreaterThan(20);
  });

  it('every tool says human only exactly when its service checks the channel', () => {
    const wrong = FINANCE_MCP_TOOLS.filter((tool) => MARKER.test(tool.description) !== (reaches(serviceOf(tool)) && !(tool.name in REACHES_BUT_NEVER_REFUSES))).map((tool) => `${tool.name} (${serviceOf(tool)})`);
    expect(wrong).toEqual([]);
    const stale = Object.keys(REACHES_BUT_NEVER_REFUSES).filter((name) => {
      const tool = FINANCE_MCP_TOOLS.find((t) => t.name === name);
      return !tool || !reaches(serviceOf(tool));
    });
    expect(stale, 'erreicht die Prüfung nicht mehr — aus der Liste nehmen').toEqual([]);
  });

  it('a tool whose service always checks refuses an agent with every permission before looking at the input — until the association allows it', async () => {
    const f = await ledgerFixture();
    const agent = { ...ctxWith([...f.deps.registry.permissionKeys], f.userId), channel: 'mcp' as const };
    const checked = FINANCE_MCP_TOOLS.filter((tool) => always(serviceOf(tool)));
    expect(checked.length).toBeGreaterThan(20);
    const answerOf = async (tool: (typeof FINANCE_MCP_TOOLS)[number]) => {
      const result = await tool.handler(f.deps, agent, sampleOf(z.toJSONSchema(tool.inputSchema, { io: 'input' }) as JsonSchema) as never).catch((error: unknown) => ({ ok: false as const, error: { type: `throws ${String(error).slice(0, 60)}` } }));
      return result.ok ? 'ok' : `${result.error.type}${'code' in result.error ? `:${String(result.error.code)}` : ''}`;
    };
    const answers: string[] = [];
    for (const tool of checked) if ((await answerOf(tool)) !== 'conflict:humanOnly') answers.push(`${tool.name}: ${await answerOf(tool)}`);
    expect(answers).toEqual([]);
    allowHumanOnlyOverMcp(f.deps);
    const stillRefused: string[] = [];
    for (const tool of checked) if ((await answerOf(tool)) === 'conflict:humanOnly') stillRefused.push(tool.name);
    expect(stillRefused).toEqual([]);
  });
});

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; const?: unknown; oneOf?: JsonSchema[]; anyOf?: JsonSchema[]; minimum?: number };

/** Ein Wert, der der Form eines JSON Schemas genügt: nur Pflichtfelder, die erste Variante, Base64-taugliche Texte. */
function sampleOf(s: JsonSchema): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const branch = s.oneOf?.[0] ?? s.anyOf?.[0];
  if (branch) return sampleOf(branch);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'object') return Object.fromEntries((s.required ?? []).map((key) => [key, sampleOf(s.properties?.[key] ?? {})]));
  if (type === 'array') return [];
  if (type === 'string') return 'AA==';
  if (type === 'number' || type === 'integer') return s.minimum ?? 1;
  if (type === 'boolean') return false;
  return null;
}

// N4 (MCP-Nachttest 0.4.0): Das SDK parst die Argumente mit dem Werkzeugschema, bevor der Dienst sie sieht — ein
// Berichtsparameter, den das MCP-Schema nicht kennt, kommt nie an. Jeder Schlüssel, den ein Bericht des Katalogs annimmt,
// steht deshalb im Schema von finance_report, finance_report_finalize und finance_report_versions.
describe('report params over MCP (N4)', () => {
  const keysOf = (schema: z.ZodType): string[] => {
    if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
    if (schema instanceof z.ZodUnion) return (schema.options as z.ZodType[]).flatMap(keysOf);
    throw new Error(`Schema ohne bekannte Form: ${schema.constructor.name}`);
  };
  const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;

  it('every param of every report passes the MCP schema of the report tools', () => {
    const keys = [...new Set(REPORT_CATALOG.flatMap((d) => keysOf(d.paramsSchema)))];
    expect(keys).toContain('vatPeriod');
    for (const name of ['finance_report', 'finance_report_finalize', 'finance_report_versions']) {
      const params = ((tool(name).inputSchema as z.ZodObject).shape.params as z.ZodOptional<z.ZodObject>).unwrap();
      expect(Object.keys(params.shape).sort(), name).toEqual(expect.arrayContaining(keys));
    }
  });

  it('reads, finalizes and lists the advance return with vatPeriod through the tool schemas', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-07-08T10:00:00.000Z');
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2026-01-01', value: true }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-12', text: 'Buchung', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -20000, taxCode: 'rc13bEu' }] }));
    const call = (name: string) => tool(name).handler(f.deps, f.ctx, (tool(name).inputSchema as z.ZodType).parse({ report: 'vatAdvanceReturn', params: { vatPeriod: '2026-Q2' } }));
    const read = await call('finance_report');
    expect(read).toMatchObject({ ok: true, value: { stage: 'review' } });
    expect(await call('finance_report_finalize')).toMatchObject({ ok: true });
    const versions = await call('finance_report_versions');
    expect(versions.ok && (versions.value as { versions: unknown[] }).versions.length).toBe(1);
  });
});
