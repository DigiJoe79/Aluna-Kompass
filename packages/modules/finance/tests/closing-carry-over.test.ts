import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditDoneInternal } from '../src/auditing/access';
import { fileAuditReportScan } from '../src/auditing/filing';
import { createAuditReportDraft, followUpOpenInternal, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { getAuditSection } from '../src/auditing/sections';
import { saveAssemblyResult } from '../src/closing/assembly';
import { carryOverAuditFollowUp } from '../src/closing/carry-over';
import { getClosingStatus } from '../src/closing/status';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, reopenInternal } from '../src/ledger/period';
import { reverseEntry } from '../src/ledger/reverse';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { finalizeFinanceReport } from '../src/reporting/finalize';
import { previewFinanceReport } from '../src/reporting/finalize';
import { runFinanceReport } from '../src/reporting/service';
import { releaseOfYearInternal } from '../src/reporting/stage';
import { financeFiscalYears } from '../src/schema';
import type { CashReport } from '../src/reporting/reports/cash-report';
import { auditFixture } from './auditing-fixture';
import { allowHumanOnlyOverMcp, insertTaxPeriod, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const renders: Record<string, unknown>[] = [];
  const original = f.deps.documents.render.bind(f.deps.documents);
  f.deps.documents.render = async (args) => {
    renders.push({ ...(args.slots as unknown as Record<string, unknown>), typst: args.bodyTypst });
    return original(args);
  };
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  const close = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  };
  const reopen = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Fehlbuchung' })));
  };
  const kept = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
  const wrong = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-03-01', text: 'Fehlbuchung', moneyLines: [{ accountId: f.bank.id, amountCents: 500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 500 }] }));
  unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
  close();
  const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
  unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
  unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
  unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
  const scan = unwrap(await fileAuditReportScan(f.deps, a.mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
  const before = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: a.y2025 } }));
  const stageTextOfLastFinalize = () => renders.at(-1)!.stageText;
  const firstStageText = stageTextOfLastFinalize();
  unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: a.y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
  reopen();
  const reversal = unwrap(await reverseEntry(f.deps, f.ctx, { id: wrong.id })).reversal;
  close();
  return { ...a, close, reopen, kept, wrong, reversal, scan, before, firstStageText, renders, stageTextOfLastFinalize };
}

describe('Nachprüfung nach der MV — Übernahme ins Folgejahr', () => {
  it('needs an open follow-up, the assembly result and a note; it is a personal declaration', async () => {
    const t = await setup();
    const { f, y2025, y2026 } = t;
    expect(followUpOpenInternal(f.deps.db, y2025)).toBe(true);
    expect(code(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2026, note: 'x' }))).toBe('auditFollowUpNotOpen');
    expect(fields(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025 }))).toEqual(['note:required']);
    expect(fields(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'x'.repeat(1001) }))).toEqual(['note:tooLong']);
    expect(code(await carryOverAuditFollowUp(f.deps, { ...f.ctx, channel: 'mcp' }, { fiscalYearId: y2025, note: 'x' }))).toBe('humanOnly');
    expect(code(await carryOverAuditFollowUp(f.deps, ctxWith(['finance.read'], f.userId), { fiscalYearId: y2025, note: 'x' }))).toBe('forbidden');
    allowHumanOnlyOverMcp(f.deps);
    expect(code(await carryOverAuditFollowUp(f.deps, { ...f.ctx, channel: 'mcp' }, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }))).toBe('ok');
  });

  it('refuses before the assembly: then only the addendum closes the follow-up', async () => {
    const a = await auditFixture({ close: false });
    const { f } = a;
    const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
    f.deps.db.transaction((tx) => unwrap(closeInternal(tx, f.deps, f.ctx, row())));
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
    unwrap(await fileAuditReportScan(f.deps, a.mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
    f.deps.clock.advance(60_000);
    f.deps.db.transaction((tx) => unwrap(reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'x' })));
    f.deps.clock.advance(60_000);
    f.deps.db.transaction((tx) => unwrap(closeInternal(tx, f.deps, f.ctx, row())));
    expect(code(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: a.y2025, note: 'Prüfer verhindert' }))).toBe('assemblyNotRecorded');
  });

  it('closes the follow-up, records the changed entries, releases again and points at the next year', async () => {
    const t = await setup();
    const { f, y2025, y2026 } = t;
    const done = unwrap(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }));
    expect(done).toMatchObject({ targetFiscalYearId: y2026, count: 2, notices: [] });
    expect(followUpOpenInternal(f.deps.db, y2025)).toBe(false);
    expect(auditDoneInternal(f.deps.db, y2025)).toBe(true);
    const entries = f.deps.sqlite.prepare('select entry_id as entryId, entry_number as entryNumber, change from finance_audit_carry_over_entries order by entry_number').all();
    expect(entries).toEqual([
      { entryId: t.wrong.id, entryNumber: t.wrong.number, change: 'reversed' },
      { entryId: t.reversal.id, entryNumber: t.reversal.number, change: 'new' },
    ].sort((x, y) => x.entryNumber!.localeCompare(y.entryNumber!)));
    expect(releaseOfYearInternal(f.deps.db, y2025)).toMatchObject({ basis: 'auditReport', documentId: t.scan.documentId, note: 'Prüfer nicht mehr im Amt' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.audit.carryOver').params!)).toEqual({ designation: '2025', count: 2 });
    expect(() => f.deps.sqlite.prepare('delete from finance_audit_carry_overs').run()).toThrow();
    const s10 = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).steps.find((s) => s.key === 'auditReport')!;
    expect(s10.facts).toMatchObject({ followUpOpen: false, carryOver: { note: 'Prüfer nicht mehr im Amt', targetDesignation: '2026' } });
    expect(code(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'nochmal' }))).toBe('auditFollowUpNotOpen');
  });

  it('points at § 153 AO when the tax return of the year is already filed (E6a)', async () => {
    const t = await setup();
    insertTaxPeriod(t.f, { firstFiscalYearId: t.y2025, filedOn: '2026-05-02' });
    const done = unwrap(await carryOverAuditFollowUp(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, note: 'Prüfer nicht mehr im Amt' }));
    expect(done.notices).toEqual(['section153']);
  });

  it('versions finalized after the carry-over say so in their head, the ones before do not', async () => {
    const t = await setup();
    const { f, y2025 } = t;
    expect(t.firstStageText).toBeUndefined();
    unwrap(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }));
    unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }));
    expect(t.stageTextOfLastFinalize()).toBe('Nach der Prüfung geändert, berichtet in 2026');
  });

  it('the cash report of the next year lists the carried-over entries; without one the key and the hash stay', async () => {
    const t = await setup();
    const { f, y2025, y2026 } = t;
    const hashBefore = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2026 } }));
    expect('priorYearCarryOvers' in (hashBefore.data as object)).toBe(false);
    unwrap(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }));
    const after = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2026 } }));
    expect((after.data as CashReport).priorYearCarryOvers).toEqual(expect.arrayContaining([{ entryNumber: t.wrong.number, fiscalYearDesignation: '2025', change: 'reversed' }, { entryNumber: t.reversal.number, fiscalYearDesignation: '2025', change: 'new' }]));
    expect(after.hash).not.toBe(hashBefore.hash);
    const unaffected = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2025 } }));
    expect('priorYearCarryOvers' in (unaffected.data as object)).toBe(false);
    unwrap(await previewFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2026 } }));
    expect(String(t.renders.at(-1)!.typst ?? JSON.stringify(t.renders.at(-1)))).toContain('11 Korrekturen an Vorjahren');
  });

  it('the audit package of the next year shows them among the anomalies', async () => {
    const t = await setup();
    const { f, y2025, y2026, mira } = t;
    unwrap(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }));
    const rows = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2026, section: 'anomalies', limit: 200 })).rows.filter((r) => r.kind === 'priorYearCarryOver');
    expect(rows.map((r) => r.labelParams).sort((a, b) => String(a.number).localeCompare(String(b.number)))).toEqual([{ number: t.wrong.number, year: '2025', change: 'reversed' }, { number: t.reversal.number, year: '2025', change: 'new' }].sort((a, b) => a.number!.localeCompare(b.number!)));
  });

  it('refuses when the next year is already closed — its final reports would change silently', async () => {
    const t = await setup();
    t.f.closeYear(t.y2026);
    expect(code(await carryOverAuditFollowUp(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, note: 'Prüfer nicht mehr im Amt' }))).toBe('carryOverTargetClosed');
  });

  it('a second reopening opens the follow-up again', async () => {
    const t = await setup();
    const { f, y2025 } = t;
    unwrap(await carryOverAuditFollowUp(f.deps, f.ctx, { fiscalYearId: y2025, note: 'Prüfer nicht mehr im Amt' }));
    t.reopen();
    t.close();
    expect(followUpOpenInternal(f.deps.db, y2025)).toBe(true);
    expect(auditDoneInternal(f.deps.db, y2025)).toBe(false);
  });
});
