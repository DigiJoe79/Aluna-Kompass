import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { removeAuditor } from '../src/auditing/auditors';
import { getEntryAuditState, markSectionReviewed, setSample, unmarkSectionReviewed } from '../src/auditing/samples';
import { getAuditSection } from '../src/auditing/sections';
import { getAuditStatus } from '../src/auditing/status';
import { approveAllocationCorrection, requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { financeAllocationLines } from '../src/schema';
import { AUDITOR_PERMISSIONS, auditFixture } from './auditing-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const book = async (date: string, cents: number, contactId?: string) =>
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents, ...(contactId ? { contactId } : {}) }] }));
  const one = await book('2025-02-01', 1000, f.wrongDonor.id);
  const two = await book('2025-03-01', 2000);
  const later = await book('2026-03-01', 3000);
  f.closeYear(a.y2025);
  const other = await a.linkedUser('Zweitprüfer');
  const { saveAuditor } = await import('../src/auditing/auditors');
  const otherAuditor = unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: a.y2025, contactId: other.contact.id, mode: 'kompass' }));
  return { ...a, one, two, later, other, otherAuditor };
}

describe('Stichproben', () => {
  it('only auditors of the year tick final entries of the year, humanOnly over MCP; audited', async () => {
    const { f, y2025, mira, one, later, linkedUser } = await setup();
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    expect(auditEntry(f.deps, 'finance.audit.sample.set').params).toBe(JSON.stringify({ number: one.number }));
    expect(code(await setSample(f.deps, { ...mira.ctx, channel: 'mcp' }, { fiscalYearId: y2025, entryId: one.id, sampled: true }))).toBe('humanOnly');
    expect(code(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: later.id, sampled: true }))).toBe('entryNotInAuditYear');
    const outsider = await linkedUser('Fremd');
    expect(code(await setSample(f.deps, outsider.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }))).toBe('auditorRequired');
    expect(code(await setSample(f.deps, f.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }))).toBe('auditorRequired');
    expect(code(await setSample(f.deps, ctxWith(['finance.read'], mira.userId), { fiscalYearId: y2025, entryId: one.id, sampled: true }))).toBe('forbidden');
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: false }));
    expect(auditEntry(f.deps, 'finance.audit.sample.unset')).toBeTruthy();
    expect(unwrap(await getEntryAuditState(f.deps, mira.ctx, { entryId: one.id }))!.mySample).toBe(false);
  });

  it('turns to recheck after an allocation correction; ticking again takes the new fingerprint', async () => {
    const { f, y2025, mira, one } = await setup();
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, one.id)).get()!;
    const requested = unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet', acknowledgeSection153: true }));
    unwrap(await approveAllocationCorrection(f.deps, f.secondPerson, { id: requested.correction.id }));
    expect(unwrap(await getEntryAuditState(f.deps, mira.ctx, { entryId: one.id }))).toMatchObject({ mySample: true, sampleState: 'recheck' });
    const recheck = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal', sample: 'recheck' }));
    expect(recheck.rows.map((r) => r.entryId)).toEqual([one.id]);
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    expect(unwrap(await getEntryAuditState(f.deps, mira.ctx, { entryId: one.id }))!.sampleState).toBe('sampled');
  });

  it('counts each entry once over all auditors; the treasurer sees numbers only', async () => {
    const { f, y2025, mira, other, one, two } = await setup();
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    unwrap(await setSample(f.deps, other.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    unwrap(await setSample(f.deps, other.ctx, { fiscalYearId: y2025, entryId: two.id, sampled: true }));
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).samples).toEqual({ sampledEntries: 2, totalEntries: 2 });
    const rows = unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'journal' })).rows;
    expect(rows.map((r) => [r.sample, r.samplesByAll])).toEqual([['none', 2], ['none', 1]]);
    const mine = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal' })).rows;
    expect(mine.map((r) => r.sample)).toEqual(['sampled', 'none']);
  });
});

describe('Abschnitt durchgesehen', () => {
  it('is per auditor and section, audited with the section, and keeps the auditor from being removed', async () => {
    const { f, y2025, mira, miraAuditor, other, otherAuditor } = await setup();
    unwrap(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'vouchers' }));
    unwrap(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'vouchers' }));
    unwrap(await markSectionReviewed(f.deps, other.ctx, { fiscalYearId: y2025, section: 'vouchers' }));
    expect(JSON.parse(auditEntry(f.deps, 'finance.audit.section.review').params!)).toEqual({ section: 'vouchers' });
    expect(unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'vouchers' })).reviewedBy.map((r) => r.auditorId)).toEqual([miraAuditor.id, otherAuditor.id]);
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).sectionsReviewed).toEqual([{ section: 'vouchers', auditorIds: [miraAuditor.id, otherAuditor.id] }]);
    expect(code(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }))).toBe('auditorHasWork');
    unwrap(await unmarkSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'vouchers' }));
    expect(auditEntry(f.deps, 'finance.audit.section.unreview')).toBeTruthy();
    expect(code(await markSectionReviewed(f.deps, ctxWith(AUDITOR_PERMISSIONS, mira.userId), { fiscalYearId: y2025, section: 'nope' }))).toBe('validation');
    expect(code(await markSectionReviewed(f.deps, { ...mira.ctx, channel: 'mcp' }, { fiscalYearId: y2025, section: 'journal' }))).toBe('humanOnly');
  });
});

describe('nach Ablage des Prüfberichts (Designer Runde 7, 274/279)', () => {
  it('refuses samples and reviews, in the service and over MCP; remarks go on', async () => {
    const { f, y2025, mira, one } = await setup();
    const { createAuditReportDraft, saveAuditReportExamination, saveAuditReportResult, markAuditReportReadyToSign } = await import('../src/auditing/report');
    const { fileAuditReportScan } = await import('../src/auditing/filing');
    const { createAuditRemark } = await import('../src/auditing/remarks');
    const { FINANCE_MCP_TOOLS } = await import('../src/mcp-tools');
    const { allowHumanOnlyOverMcp, pdfBytes } = await import('./helpers');
    unwrap(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: true }));
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }));
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
    expect(code(await setSample(f.deps, mira.ctx, { fiscalYearId: y2025, entryId: one.id, sampled: false }))).toBe('auditWorkFixed');
    expect(code(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'vouchers' }))).toBe('auditWorkFixed');
    expect(code(await unmarkSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'vouchers' }))).toBe('auditWorkFixed');
    allowHumanOnlyOverMcp(f.deps);
    const mcp = { ...mira.ctx, channel: 'mcp' as const };
    const sampleTool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_audit_sample_set')!;
    expect(code((await sampleTool.handler(f.deps, mcp, { fiscalYearId: y2025, entryId: one.id, sampled: false })) as never)).toBe('auditWorkFixed');
    expect(code(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, targetType: 'year', targetId: y2025, kind: 'question', text: 'Noch eine Frage' }))).toBe('ok');
  });
});
