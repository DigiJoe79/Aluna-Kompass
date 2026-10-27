import { unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveAuditor } from '../src/auditing/auditors';
import { createAuditRemark, resolveAuditRemark } from '../src/auditing/remarks';
import {
  createAuditReportDraft, getAuditReport, markAuditReportReadyToSign, revokeAuditReportReadyToSign, saveAuditReportDeviation, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures,
} from '../src/auditing/report';
import { getAuditStatus } from '../src/auditing/status';
import { auditFixture } from './auditing-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  const a = await auditFixture();
  const other = await a.linkedUser('Zweitprüfer');
  const otherAuditor = unwrap(await saveAuditor(a.f.deps, a.f.ctx, { fiscalYearId: a.y2025, contactId: other.contact.id, mode: 'kompass' }));
  return { ...a, other, otherAuditor };
}

describe('Prüfbericht — Entwurf', () => {
  it('only an editor creates it: not the treasurer, not an auditor of another year, not over MCP, not twice', async () => {
    const { f, y2025, y2026, mira, linkedUser } = await setup();
    expect(code(await createAuditReportDraft(f.deps, f.ctx, { fiscalYearId: y2025, kind: 'report' }))).toBe('auditorHasWriteRights');
    const elsewhere = await linkedUser('Anderesjahr');
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2026, contactId: elsewhere.contact.id, mode: 'kompass' }));
    expect(code(await createAuditReportDraft(f.deps, elsewhere.ctx, { fiscalYearId: y2025, kind: 'report' }))).toBe('auditorRequired');
    expect(code(await createAuditReportDraft(f.deps, { ...mira.ctx, channel: 'mcp' }, { fiscalYearId: y2025, kind: 'report' }))).toBe('humanOnly');
    expect(code(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'followUp' }))).toBe('auditFollowUpNotOpen');
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(draft).toMatchObject({ kind: 'report', origin: 'kompass', state: 'draft', canEdit: true, subject: { designation: '2025', baseline: { id: status.referenceBaselineId } } });
    expect(code(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }))).toBe('auditReportExists');
    expect(auditEntry(f.deps, 'finance.audit.report.create')).toMatchObject({ entityId: draft.id });
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))).toMatchObject({ id: draft.id, canEdit: false, myAuditorId: null });
    expect(status.report).toMatchObject({ id: draft.id, state: 'draft', scansExpected: 1, scansFiled: 0 });
  });

  it('cards save on their own, with their own version; two auditors edit the same draft', async () => {
    const { f, y2025, mira, other } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    f.deps.clock.advance(1000);
    const exam = unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, expectedVersion: draft.examination.version, dates: ['2026-02-18'], place: 'Vereinsheim' }));
    expect(exam.examination).toMatchObject({ dates: ['2026-02-18'], place: 'Vereinsheim', updatedByUserId: mira.userId });
    f.deps.clock.advance(1000);
    // Der andere speichert eine andere Karte mit dem alten Stand der Seite — kein Konflikt.
    const result = unwrap(await saveAuditReportResult(f.deps, other.ctx, { reportId: draft.id, expectedVersion: draft.results[0]!.version, result: 'clean', recommendation: 'discharge' }));
    expect(result.results).toEqual([expect.objectContaining({ auditorId: null, result: 'clean', recommendation: 'discharge', updatedByUserId: other.userId })]);
    // Dieselbe Karte mit dem alten Stand: Konflikt.
    expect(code(await saveAuditReportExamination(f.deps, other.ctx, { reportId: draft.id, expectedVersion: draft.examination.version, dates: ['2026-02-19'] }))).toBe('staleVersion');
    expect(result.editorNames).toEqual(['Testa Prüferin', 'Testa Zweitprüfer']);
    expect(code(await saveAuditReportResult(f.deps, f.ctx, { reportId: draft.id, result: 'clean' }))).toBe('auditorHasWriteRights');
  });

  it('suggests „with findings“; findings and open questions come from the remarks, resolved questions do not', async () => {
    const { f, y2025, mira } = await setup();
    const q1 = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Offen?' }));
    const q2 = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Geklärt?' }));
    unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: q2.id }));
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(draft.suggestedResult).toBe('clean');
    expect(draft.openQuestions.map((r) => r.id)).toEqual([q1.id]);
    const finding = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'finding', targetType: 'year', targetId: y2025, text: 'Beleg fehlt.' }));
    const again = unwrap(await getAuditReport(f.deps, mira.ctx, { fiscalYearId: y2025 }))!;
    expect(again.suggestedResult).toBe('withFindings');
    expect(again.findings.map((r) => r.id)).toEqual([finding.id]);
  });

  // N15 (Nachttest 0.4.0, Joe 2026-10-27): „Ohne Beanstandung“ trotz ungeklärter Vermerke wird gespeichert — die Antwort
  // trägt einen Hinweis mit der Zahl. Die Entscheidung gehört den Prüfern, keine Sperre.
  it('notes open remarks when the result is clean, without refusing it', async () => {
    const { f, y2025, mira } = await setup();
    const finding = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'finding', targetType: 'year', targetId: y2025, text: 'Beleg fehlt.' }));
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Offen?' }));
    const resolved = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Geklärt?' }));
    unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: resolved.id }));
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(draft).toMatchObject({ openRemarks: 2, notices: [] });
    const clean = unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean', recommendation: 'discharge' }));
    expect(clean).toMatchObject({ results: [expect.objectContaining({ result: 'clean' })], openRemarks: 2, notices: ['cleanWithOpenRemarks'] });
    const withFindings = unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, expectedVersion: clean.results[0]!.version, result: 'withFindings', recommendation: 'none' }));
    expect(withFindings.notices).toEqual([]);
    unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: finding.id }));
    const again = unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, expectedVersion: withFindings.results[0]!.version, result: 'clean', recommendation: 'discharge' }));
    expect(again).toMatchObject({ openRemarks: 1, notices: ['cleanWithOpenRemarks'] });
  });

  it('separate reports: each auditor his own result and recommendation; deviations only the own field', async () => {
    const { f, y2025, mira, other, miraAuditor, otherAuditor, paperAuditor } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    const sep = unwrap(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'separate' }));
    expect(sep.scansExpected).toBe(3);
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean', recommendation: 'discharge' }));
    const after = unwrap(await saveAuditReportResult(f.deps, other.ctx, { reportId: draft.id, result: 'withFindings', recommendation: 'noDischarge' }));
    expect(after.results.map((r) => [r.auditorId, r.result, r.recommendation])).toEqual([[miraAuditor.id, 'clean', 'discharge'], [paperAuditor.id, null, 'none'], [otherAuditor.id, 'withFindings', 'noDischarge']]);
    unwrap(await saveAuditReportDeviation(f.deps, mira.ctx, { reportId: draft.id, text: 'Ich sehe das anders.' }));
    expect(unwrap(await getAuditReport(f.deps, other.ctx, { fiscalYearId: y2025 }))!.deviations).toEqual([expect.objectContaining({ auditorId: miraAuditor.id, text: 'Ich sehe das anders.' })]);
  });

  it('one signs: non-signer of the year and a reason are required', async () => {
    const { f, y2025, mira, paperAuditor } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'one' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(code(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'one', nonSignerAuditorId: paperAuditor.id, nonSignerReason: 'x'.repeat(301) }))).toBe('validation');
    const saved = unwrap(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'one', nonSignerAuditorId: paperAuditor.id, nonSignerReason: 'verhindert' }));
    expect(saved.signatures).toMatchObject({ mode: 'one', nonSignerAuditorId: paperAuditor.id, nonSignerReason: 'verhindert' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.audit.report.signatures').params!)).toEqual({ designation: '2025', kind: 'report', mode: 'one' });
  });

  it('ready to sign fixes the text; revoke goes back until the first scan', async () => {
    const { f, y2025, mira } = await setup();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(code(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }))).toBe('auditReportIncomplete');
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean' }));
    const ready = unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }));
    expect(ready).toMatchObject({ state: 'readyToSign', canEdit: false });
    expect(auditEntry(f.deps, 'finance.audit.report.ready')).toMatchObject({ entityId: draft.id });
    expect(code(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-19'] }))).toBe('auditReportReadyToSign');
    expect(unwrap(await revokeAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id })).state).toBe('draft');
    expect(code(await revokeAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }))).toBe('auditReportNotReadyToSign');
  });
});
