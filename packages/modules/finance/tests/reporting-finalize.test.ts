import { createHash } from 'node:crypto';
import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setDatedValue, valueAt } from '../src/ledger/dated-values';
import { reportDefinition, withTestReports } from '../src/reporting/catalog';
import { finalizeFinanceReport, previewFinanceReport, readFinanceReportDocument, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { runFinanceReport } from '../src/reporting/service';
import { financeReports } from '../src/schema';
import { ledgerFixture } from './helpers';
import { testReport } from './reporting-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

/** Die Aufrufe der Render-Engine mitschreiben, ohne sie zu ersetzen (wie `confirmation-preview.test.ts`). */
function recordRenders(f: Fixture) {
  const calls: Parameters<Fixture['deps']['documents']['render']>[0][] = [];
  const original = f.deps.documents.render.bind(f.deps.documents);
  f.deps.documents.render = async (args) => {
    calls.push(args);
    return original(args);
  };
  return calls;
}

/** Ein Bericht, dessen Datenstand sich ohne Buchung ändern lässt: der Kilometersatz am Jahresende 2025. */
const mutable = testReport({ key: 'testMutable', compute: (db) => ({ lines: 0, totalCents: Number(valueAt(db, 'mileageRate', '2025-12-31') ?? 0) }) });
const tax = testReport({ key: 'testTax', group: 'taxOffice' });
const REPORTS = [testReport(), tax, mutable];

const setup = async () => {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  return { f, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
};
const auditActions = (f: Fixture) => f.deps.db.select().from(schema.auditLog).all().map((a) => a.action);

describe('previewFinanceReport, finalizeFinanceReport, releaseReportsForFinalizing (Rechenschaft A1 Task 5)', () => {
  it('previews with stage text and footer note', async () => {
    const { f, y2026 } = await setup();
    const renders = recordRenders(f);
    await withTestReports(REPORTS, async () => {
      const before = f.deps.db.select().from(documents).all().length;
      const auditBefore = auditActions(f).length;
      const preview = unwrap(await previewFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2026 } }));
      expect(preview.stage).toBe('preliminary');
      expect(new TextDecoder().decode(preview.bytes.subarray(0, 5))).toBe('%PDF-');
      expect(renders).toHaveLength(1);
      expect(renders[0]!.baseId).toBe('a4-quer-plain-slim');
      expect(renders[0]!.slots).toMatchObject({ kind: 'report', title: 'Testbericht', subtitle: 'Geschäftsjahr 2026', stage: 'preliminary', stageText: 'VORLÄUFIG' });
      expect(renders[0]!.slots.draft).toBeUndefined();
      expect(renders[0]!.slots.footerNote).toMatch(/^Erzeugt \d\d\.\d\d\.\d{4}, \d\d:\d\d · /);
      expect(renders[0]!.slots.footerNote!.endsWith(`· ${preview.shortHash}`)).toBe(true);
      expect(f.deps.db.select().from(documents).all()).toHaveLength(before);
      expect(auditActions(f)).toHaveLength(auditBefore);
      // Nur das Leserecht: die Vorschau eines Berichts ohne Personenbezug mit finance.overview.
      expect(err(await previewFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'testAssembly', params: { fiscalYearId: y2026 } }))).toBe('ok');
    });
  });

  it('refuses to finalize an open year', async () => {
    const { f, y2026 } = await setup();
    await withTestReports(REPORTS, async () => {
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2026 } }))).toMatchObject({ code: 'reportYearOpen' });
    });
  });

  it('needs a release for assembly reports', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const renders = recordRenders(f);
    await withTestReports(REPORTS, async () => {
      const params = { fiscalYearId: y2025 };
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params })).stage).toBe('review');
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }))).toMatchObject({ code: 'reportNotReleased' });

      expect(unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }))).toEqual({ fiscalYearId: y2025, basis: 'oralReport' });
      expect(auditActions(f)).toContain('finance.report.release');

      const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }));
      expect(done.documentNumber).toMatch(/^FBR-/);
      const doc = f.deps.db.select().from(documents).where(eq(documents.id, done.documentId)).get()!;
      expect(doc).toMatchObject({ typeKey: 'finance-report', status: 'issued' });
      expect(JSON.parse(doc.inputSnapshot!).input).toMatchObject({ report: 'testAssembly', params, dataHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, done.documentId)).all().map((l) => `${l.entityType}:${l.entityId}`);
      expect(links.sort()).toEqual([`financeFiscalYear:${y2025}`, `financeReport:${done.reportId}`].sort());
      expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, done.reportId)).get()).toMatchObject({ reportKey: 'testAssembly', fiscalYearId: y2025, releaseBasis: 'oralReport', voidedAt: null, documentNumber: done.documentNumber });
      expect(auditActions(f)).toContain('finance.report.finalize');
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params })).stage).toBe('final');
      expect(renders.at(-1)!.slots).toMatchObject({ stage: 'final', stageText: 'Ohne schriftlichen Prüfbericht festgeschrieben' });
    });
  });

  it('finalizes tax office reports without release', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const renders = recordRenders(f);
    await withTestReports(REPORTS, async () => {
      const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, done.reportId)).get()!.releaseBasis).toBeNull();
      expect(renders.at(-1)!.slots.stage).toBe('final');
      expect(renders.at(-1)!.slots.stageText).toBeUndefined();
    });
  });

  it('files a personal report as its own document type', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports([testReport({ key: 'testPersonalTax', group: 'taxOffice', personal: true })], async () => {
      const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testPersonalTax', params: { fiscalYearId: y2025 } }));
      expect(done.documentNumber).toMatch(/^FBP-/);
      expect(err(await finalizeFinanceReport(f.deps, ctxWith(['finance.reportsFinalize', 'finance.overview'], f.userId), { report: 'testPersonalTax', params: { fiscalYearId: y2025 } }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    });
  });

  it('refuses a second finalize of the same data', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      const first = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      const docs = f.deps.db.select().from(documents).all().length;
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }))).toMatchObject({ code: 'reportAlreadyFinal', params: { documentNumber: first.documentNumber } });
      expect(f.deps.db.select().from(documents).all()).toHaveLength(docs);
    });
  });

  it('replaces an older final version when the data changed', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'noAuditProvided', note: null }));
      const params = { fiscalYearId: y2025 };
      const first = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      // Der Datenstand ändert sich (wie nach einer Zuordnungskorrektur): anderer Hash, wieder `review`.
      unwrap(await setDatedValue(f.deps, f.ctx, { key: 'mileageRate', validFrom: '2025-01-01', value: 25 }));
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testMutable', params })).stage).toBe('review');

      const second = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testMutable', params }));
      expect(second.shortHash).not.toBe(first.shortHash);
      const old = f.deps.db.select().from(financeReports).where(eq(financeReports.id, first.reportId)).get()!;
      expect(old.voidedAt).not.toBeNull();
      expect(old.replacedByReportId).toBe(second.reportId);
      expect(old.voidReason).toBe(`Ersetzt durch ${second.documentNumber}`);
      expect(f.deps.db.select().from(documents).where(eq(documents.id, first.documentId)).get()).toMatchObject({ status: 'voided', voidReason: `Ersetzt durch ${second.documentNumber}` });
      expect(f.deps.db.select().from(financeReports).where(eq(financeReports.id, second.reportId)).get()!.voidedAt).toBeNull();
      expect(auditActions(f)).toContain('finance.report.void');
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testMutable', params })).stage).toBe('final');
    });
  });

  it('is human only', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const agent = { ...f.ctx, channel: 'mcp' as const };
    await withTestReports(REPORTS, async () => {
      expect(err(await finalizeFinanceReport(f.deps, agent, { report: 'testTax', params: { fiscalYearId: y2025 } }))).toMatchObject({ code: 'humanOnly' });
      expect(err(await releaseReportsForFinalizing(f.deps, agent, { fiscalYearId: y2025, basis: 'oralReport', note: null }))).toMatchObject({ code: 'humanOnly' });
    });
  });

  it('needs finance.reportsFinalize, and finance.periodClose for the release', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      expect(err(await finalizeFinanceReport(f.deps, ctxWith(['finance.read'], f.userId), { report: 'testTax', params: { fiscalYearId: y2025 } }))).toEqual({ type: 'forbidden', permission: 'finance.reportsFinalize' });
      expect(err(await releaseReportsForFinalizing(f.deps, ctxWith(['finance.read', 'finance.reportsFinalize'], f.userId), { fiscalYearId: y2025, basis: 'oralReport', note: null }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });
    });
  });

  it('validates the release: no audit report by hand, a note for other, a closed year', async () => {
    const { f, y2025, y2026 } = await setup();
    f.closeYear(y2025);
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'auditReport', note: null }))).toMatchObject({ type: 'validation' });
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'other', note: null }))).toMatchObject({ type: 'validation' });
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'other', note: 'Prüfer erkrankt, Prüfung im Frühjahr' }))).toBe('ok');
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2026, basis: 'oralReport', note: null }))).toMatchObject({ code: 'reportYearOpen' });
    expect(err(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: 'nope', basis: 'oralReport', note: null }))).toMatchObject({ type: 'notFound' });
  });
});

describe('Arbeitslisten werden nicht festgeschrieben (Joe 2026-10-25, Befund 15 Entscheidung 2)', () => {
  it('the catalogue: monthly overview, handover list and project statement are not finalizable (Designer Runde 7, 261)', () => {
    expect(reportDefinition('monthlyOverview')!.finalizable).toBe(false);
    expect(reportDefinition('handoverList')!.finalizable).toBe(false);
    expect(reportDefinition('projectStatement')!.finalizable).toBe(false);
    expect(reportDefinition('cashReport')!.finalizable ?? true).toBe(true);
  });

  it('a report that is not finalizable stays preliminary, says so in the run and refuses to finalize', async () => {
    const { f, y2025 } = await setup();
    const workList = testReport({ key: 'testWorkList', group: 'work', finalizable: false });
    await withTestReports([workList, testReport({ key: 'testWork', group: 'work' })], async () => {
      f.closeYear(y2025);
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testWorkList', params: { fiscalYearId: y2025 } }));
      expect(run).toMatchObject({ stage: 'preliminary', finalizable: false, finalizeBlock: { code: 'reportNotFinalizable' } });
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testWorkList', params: { fiscalYearId: y2025 } }))).toMatchObject({ code: 'reportNotFinalizable' });
      // Gegenprobe: derselbe Bericht ohne die Angabe ist festschreibbar.
      const other = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testWork', params: { fiscalYearId: y2025 } }));
      expect(other).toMatchObject({ stage: 'review', finalizable: true, finalizeBlock: null });
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testWork', params: { fiscalYearId: y2025 } }))).toBe('ok');
    });
  });
});

describe('Fassung aus der Akte und Bericht ohne Inhalt (Designer Runde 7, 16a)', () => {
  it('a final run names the version in the records: its file is the filed document with the same hash', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    await withTestReports(REPORTS, async () => {
      const review = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      expect(review).toMatchObject({ stage: 'review', finalVersion: null });
      const done = unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }));
      expect(run.stage).toBe('final');
      expect(run.finalVersion).toMatchObject({ reportId: done.reportId, documentId: done.documentId, documentNumber: done.documentNumber, shortHash: run.shortHash });
      const filed = unwrap(await readFinanceReportDocument(f.deps, f.ctx, { reportId: run.finalVersion!.reportId }));
      const doc = f.deps.db.select().from(documents).where(eq(documents.id, done.documentId)).get()!;
      expect(createHash('sha256').update(filed.bytes).digest('hex')).toBe(doc.fileChecksum);
    });
  });

  it('a report without content says so in the run with the sentence of its paper; one with content does not', async () => {
    const { f, y2025 } = await setup();
    const emptyOne = testReport({ key: 'testEmpty', group: 'taxOffice', empty: (d) => (d.lines === 0 ? 'Im Geschäftsjahr gibt es nichts.' : null) });
    await withTestReports([emptyOne], async () => {
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testEmpty', params: { fiscalYearId: y2025 } })).empty).toBe('Im Geschäftsjahr gibt es nichts.');
    });
    // Gegenprobe ohne die Fähigkeit: `null`.
    await withTestReports(REPORTS, async () => {
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } })).empty).toBeNull();
    });
  });

  it('the people overview without rows: the sentence of the run is the one on the paper', async () => {
    const { f, y2025 } = await setup();
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'peopleOverview', params: { fiscalYearId: y2025 } }));
    expect(run.empty).toBeTruthy();
    const def = reportDefinition('peopleOverview')!;
    expect(def.toTypst(run.data, { categoryNames: {}, accountNames: {}, labels: {} })).toContain(run.empty!);
  });
});
