import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { endAuditorAccess, removeAuditor } from '../src/auditing/auditors';
import { fileAuditReportScan } from '../src/auditing/filing';
import { createAuditRemark } from '../src/auditing/remarks';
import { createAuditReportDraft, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

const tile = (key: string) => FINANCE_DASHBOARD_TILES.find((t) => t.key === key)!;
const keys = (content: Awaited<ReturnType<(typeof FINANCE_DASHBOARD_TILES)[number]['load']>>) => (content.kind === 'list' ? content.lines.map((l) => l.titleKey) : []);

describe('Kachel Kassenprüfung (Board 7a)', () => {
  it('lists open questions and the missing report, then the open auditor access, then rest', async () => {
    const { f, y2025, mira, miraAuditor } = await auditFixture();
    expect(tile('audit')).toMatchObject({ permission: ['finance.read', 'finance.audit'], kind: 'list' });
    expect(tile('audit').available!(f.deps)).toBe(true);
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Offen?' }));
    const first = await tile('audit').load(f.deps, mira.ctx, {});
    expect(keys(first)).toEqual(['questionsOpen', 'reportMissing']);
    expect(first.kind === 'list' && first.lines[0]!.values).toEqual({ count: 1, designation: '2025' });

    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }));
    unwrap(await fileAuditReportScan(f.deps, mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
    expect(keys(await tile('audit').load(f.deps, f.ctx, {}))).toEqual(['questionsOpen', 'accessOpen']);
    unwrap(await endAuditorAccess(f.deps, f.ctx, { id: miraAuditor.id }));
    // Die Frage bleibt offen, bis die Prüferin sie klärt — der Zugang ist beendet.
    expect(keys(await tile('audit').load(f.deps, f.ctx, {}))).toEqual(['questionsOpen']);
  });

  it('shows „abgeschlossen am“ at rest and nothing without auditors', async () => {
    const { f, y2025, miraAuditor, paperAuditor } = await auditFixture();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    unwrap(await fileAuditReportScan(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes() }));
    const rest = await tile('audit').load(f.deps, f.ctx, {});
    expect(rest.kind === 'list' && rest.lines).toEqual([expect.objectContaining({ titleKey: 'done', values: { designation: '2025', filedOn: '2026-09-05' } })]);
    void paperAuditor;
    const none = await auditFixture({ close: false });
    for (const a of [none.miraAuditor, none.paperAuditor]) unwrap(await removeAuditor(none.f.deps, none.f.ctx, { id: a.id }));
    expect(tile('audit').available!(none.f.deps)).toBe(false);
  });

  it('the to-do tile names open questions for those who answer', async () => {
    const { f, y2025, mira } = await auditFixture();
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Offen?' }));
    const todo = await tile('todo').load(f.deps, f.ctx, {});
    expect(todo.kind === 'list' && todo.lines.find((l) => l.titleKey === 'auditQuestionsOpen')).toMatchObject({ values: { count: 1 }, href: '/finance/audit' });
    const forAuditor = await tile('todo').load(f.deps, mira.ctx, {});
    expect(keys(forAuditor)).not.toContain('auditQuestionsOpen');
  });
});
