import { unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { removeAuditor, saveAuditor } from '../src/auditing/auditors';
import { printAuditReport, printAuditReportBlank } from '../src/auditing/print';
import { createAuditReportDraft, getAuditReport, markAuditReportReadyToSign, saveAuditReportDeviation, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures } from '../src/auditing/report';
import { buildAuditReportPrint } from '../src/auditing/report-template';
import { auditFixture } from './auditing-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

/** Fängt, was an die Dokument-Engine geht — die Attrappe rendert nur den Titel. */
function captureRender(f: Awaited<ReturnType<typeof auditFixture>>['f']) {
  const calls: { baseId: string; bodyTypst: string; slots: Record<string, unknown> }[] = [];
  const original = f.deps.documents.render;
  f.deps.documents.render = async (args) => {
    calls.push({ baseId: args.baseId, bodyTypst: args.bodyTypst, slots: args.slots as unknown as Record<string, unknown> });
    return original(args);
  };
  return calls;
}

describe('Prüfbericht drucken', () => {
  it('the baseline day is the day in the association\'s zone (F-B3)', async () => {
    const { f, y2025, mira } = await auditFixture({ close: false });
    // Abschluss um 0:30 Uhr am 01.01. — die Prüffassung entsteht beim Abschluss.
    f.deps.clock.set('2026-12-31T23:30:00.000Z');
    f.closeYear(y2025);
    const calls = captureRender(f);
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    unwrap(await printAuditReport(f.deps, mira.ctx, { reportId: draft.id }));
    expect(String(calls[0]!.slots.footerNote)).toMatch(/^Prüfstand vom 01\.01\.2027 · /);
  });

  it('prints the draft with ENTWURF, ready without; sections, signature lines, short hash; audited; no document', async () => {
    const { f, y2025, mira, paperAuditor } = await auditFixture();
    const calls = captureRender(f);
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    const printed = unwrap(await printAuditReport(f.deps, mira.ctx, { reportId: draft.id }));
    expect(printed.filename).toBe('Pruefbericht-2025-Entwurf.pdf');
    expect(calls[0]).toMatchObject({ baseId: 'a4-plain-slim', slots: { stage: 'preliminary', stageText: 'ENTWURF', title: 'Prüfbericht 2025' } });
    expect(String(calls[0]!.slots.footerNote)).toMatch(/^Prüfstand vom 05\.09\.2026 · [0-9a-f]{8}$/);
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-02-18'], place: 'Vereinsheim' }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'clean', recommendation: 'discharge' }));
    unwrap(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'one', nonSignerAuditorId: paperAuditor.id, nonSignerReason: 'verhindert' }));
    unwrap(await markAuditReportReadyToSign(f.deps, mira.ctx, { reportId: draft.id }));
    unwrap(await printAuditReport(f.deps, f.ctx, { reportId: draft.id }));
    const body = calls[1]!.bodyTypst;
    expect(calls[1]!.slots).toMatchObject({ stage: 'final' });
    expect(calls[1]!.slots.stageText).toBeUndefined();
    for (const heading of ['Gegenstand der Prüfung', 'Prüfung', 'Feststellungen', 'Offene Fragen', 'Ergebnis', 'Empfehlung zur Entlastung', 'Abweichende Feststellungen · #"Testa Prüferin";', 'Unterschriften']) expect(body).toContain(heading);
    expect(body).toContain('18.02.2026');
    expect(body).toContain('☒ ohne Beanstandung');
    expect(body).toContain('#"Paul Papierprüfer";: nicht unterschrieben: #"verhindert";');
    expect(body).toContain('Unterschrift #"Testa Prüferin";');
    expect(auditEntry(f.deps, 'finance.audit.report.print')).toMatchObject({ entityId: draft.id });
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.lastPrintedAt).not.toBeNull();
    expect(f.deps.sqlite.prepare("select count(*) as n from documents").get()).toEqual({ n: 0 });
  });

  it('separate reports print one part per auditor, paper auditors with empty lines and boxes', async () => {
    const { f, y2025, mira } = await auditFixture();
    const calls = captureRender(f);
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    unwrap(await saveAuditReportSignatures(f.deps, mira.ctx, { reportId: draft.id, mode: 'separate' }));
    unwrap(await saveAuditReportResult(f.deps, mira.ctx, { reportId: draft.id, result: 'withFindings' }));
    unwrap(await saveAuditReportDeviation(f.deps, mira.ctx, { reportId: draft.id, text: 'Barkasse unklar.' }));
    unwrap(await printAuditReport(f.deps, mira.ctx, { reportId: draft.id }));
    const body = calls[0]!.bodyTypst;
    expect(body.split('#pagebreak()')).toHaveLength(2);
    expect(body).toContain('== #"Testa Prüferin";');
    expect(body).toContain('== #"Paul Papierprüfer";');
    expect(body).toContain('☐ ohne Beanstandung #h(8mm) ☒ mit Feststellungen');
    expect(body).toContain('Barkasse unklar.');
  });

  it('only editors or finance.periodClose print', async () => {
    const { f, y2025, mira, linkedUser } = await auditFixture();
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    const outsider = await linkedUser('Fremd');
    expect(code(await printAuditReport(f.deps, outsider.ctx, { reportId: draft.id }))).toBe('auditorRequired');
  });
});

describe('Vordruck', () => {
  it('with only paper auditors: creates a blank report ready to sign once, fills in what Kompass knows', async () => {
    const { f, y2025, mira, miraAuditor } = await auditFixture();
    expect(code(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }))).toBe('auditBlankKompassAuditor');
    unwrap(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }));
    void mira;
    const calls = captureRender(f);
    const first = unwrap(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }));
    const again = unwrap(await printAuditReportBlank(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(again.reportId).toBe(first.reportId);
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))).toMatchObject({ id: first.reportId, origin: 'blank', state: 'readyToSign', canEdit: false });
    const body = calls[0]!.bodyTypst;
    expect(body).toContain('Gegenstand der Prüfung');
    expect(body).toContain('Paul Papierprüfer, auf Papier');
    expect(body).toContain('☐ ohne Beanstandung #h(8mm) ☐ mit Feststellungen');
    expect(body).toContain('#line(length: 100%');
    expect(code(await printAuditReportBlank(f.deps, mira.ctx, { fiscalYearId: y2025 }))).toBe('forbidden');
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass' }));
    expect(code(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }))).toBe('auditReportExists');
  });

  it('the template is pure and escapes free text', () => {
    const built = buildAuditReportPrint({ title: 'Prüfbericht 2025', subtitle: '', draft: false, footerNote: 'x', subject: [{ label: 'Verein', value: 'A #b' }], changed: null, examination: null, findings: [], openQuestions: [], blankRemarks: true, parts: [{ heading: null, result: null, recommendation: null, deviations: [], signatures: [] }] });
    expect(built.body.typst).toContain('#"A #b";');
    expect(built.slots).toMatchObject({ kind: 'report', stage: 'final' });
  });
});
