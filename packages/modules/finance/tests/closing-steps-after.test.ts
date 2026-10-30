import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { setDatedValue } from '../src/ledger/dated-values';
import { describe, expect, it } from 'vitest';
import { fileAuditReportScan } from '../src/auditing/filing';
import { createAuditReportDraft, followUpOpenInternal, markAuditReportReadyToSign, saveAuditReportExamination, saveAuditReportResult } from '../src/auditing/report';
import { saveAssemblyResult } from '../src/closing/assembly';
import { confirmClosingStep } from '../src/closing/confirmations';
import { getClosingStatus } from '../src/closing/status';
import type { ClosingStatus, ClosingStepKey } from '../src/closing/types';
import { setAccountActive } from '../src/ledger/accounts';
import { fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { bookEntry } from '../src/ledger/finalize';
import { closeInternal, reopenInternal } from '../src/ledger/period';
import { REPORT_CATALOG } from '../src/reporting/catalog';
import { finalizeFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { listFinanceReports } from '../src/reporting/service';
import { getAuditStatus } from '../src/auditing/status';
import { financeAccounts, financeCategories, financeFiscalYears } from '../src/schema';
import { auditFixture } from './auditing-fixture';
import { ledgerFixture, pdfBytes, setupFinance } from './helpers';
import { systemContext } from '@kompass/core/testing';
import { installFinance } from '../src/install';
import { createAccount } from '../src/ledger/accounts';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, a.y2025)).get()!;
  const close = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  };
  const reopen = () => {
    f.deps.clock.advance(60_000);
    unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: a.y2025, note: 'Fehlbuchung' })));
  };
  const status = async () => unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: a.y2025 }));
  const step = (s: ClosingStatus, key: ClosingStepKey) => s.steps.find((x) => x.key === key)!;
  const fileReport = async () => {
    const draft = unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: draft.id, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: draft.id, result: 'clean' }));
    unwrap(await markAuditReportReadyToSign(f.deps, a.mira.ctx, { reportId: draft.id }));
    return unwrap(await fileAuditReportScan(f.deps, a.mira.ctx, { reportId: draft.id, bytes: pdfBytes() }));
  };
  const finalizeAssemblyReports = async () => {
    for (const def of REPORT_CATALOG.filter((d) => d.group === 'assembly' && d.available)) unwrap(await finalizeFinanceReport(f.deps, f.ctx, { report: def.key, params: { fiscalYearId: a.y2025 } }));
  };
  return { ...a, close, reopen, status, step, fileReport, finalizeAssemblyReports };
}

describe('Jahresabschluss — Schritte 9 bis 12', () => {
  it('compares the assembly with the filing day in the association\'s zone (F-B3)', async () => {
    const t = await setup();
    t.close();
    t.f.deps.clock.set('2026-02-19T23:30:00.000Z');
    await t.fileReport();
    t.f.deps.clock.set('2026-04-01T10:00:00.000Z');
    const saved = unwrap(await saveAssemblyResult(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, assemblyOn: '2026-02-19', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    expect(saved.warnings).toEqual(['assemblyBeforeAuditReport']);
  });

  it('warns when the assembly lies before the filed audit report, and saves anyway (Entscheidung c)', async () => {
    const t = await setup();
    t.close();
    t.f.deps.clock.set('2026-02-20T10:00:00.000Z');
    await t.fileReport();
    t.f.deps.clock.set('2026-04-01T10:00:00.000Z');
    const save = (assemblyOn: string) => saveAssemblyResult(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, assemblyOn, dischargeMode: 'collective', collectiveOutcome: 'granted' });
    expect(unwrap(await save('2026-02-10'))).toMatchObject({ assemblyOn: '2026-02-10', warnings: ['assemblyBeforeAuditReport'], auditReportFiledAt: '2026-02-20T10:00:00.000Z' });
    expect(unwrap(await save('2026-03-14'))).toMatchObject({ assemblyOn: '2026-03-14', warnings: [] });
  });

  it('names the auditors with their access and waits for the package run', async () => {
    const t = await setup();
    t.close();
    const s9 = t.step(await t.status(), 'auditPackage');
    expect(s9).toMatchObject({ done: false, confirmable: false, facts: { key: 'auditPackage', packageRun: 'none', skippedBy: null } });
    expect(s9.facts.key === 'auditPackage' && s9.facts.auditors).toEqual([
      { id: t.miraAuditor.id, name: 'Testa Prüferin', mode: 'kompass', accessOk: true },
      { id: t.paperAuditor.id, name: 'Paul Papierprüfer', mode: 'paper', accessOk: true },
    ]);
  });

  it('skips the package step when no audit is foreseen', async () => {
    const t = await setup();
    expect(t.step(await t.status(), 'auditPackage').done).toBe(false);
    t.close();
    unwrap(await releaseReportsForFinalizing(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, basis: 'noAuditProvided', note: 'Satzung sieht keine Prüfung vor' }));
    expect(t.step(await t.status(), 'auditPackage')).toMatchObject({ done: true, facts: { skippedBy: 'noAuditProvided' } });
  });

  it('counts the package step done once the audit report is filed', async () => {
    const t = await setup();
    t.close();
    await t.fileReport();
    expect(t.step(await t.status(), 'auditPackage').done).toBe(true);
  });

  it('waits for the assembly reports after the release', async () => {
    const t = await setup();
    t.close();
    expect(t.step(await t.status(), 'auditReport')).toMatchObject({ done: false, facts: { release: null, filedAt: null, assemblyReports: { done: 0, total: 3 }, carryOver: null } });
    const filed = await t.fileReport();
    let s10 = t.step(await t.status(), 'auditReport');
    expect(s10).toMatchObject({ done: false, facts: { release: { basis: 'auditReport', documentId: filed.documentId }, filedAt: expect.any(String), followUpOpen: false, assemblyReports: { done: 0, total: 3 } } });
    await t.finalizeAssemblyReports();
    s10 = t.step(await t.status(), 'auditReport');
    expect(s10).toMatchObject({ done: true, facts: { assemblyReports: { done: 3, total: 3 } } });
  });

  it('reports the follow-up with the changed entries', async () => {
    const t = await setup();
    t.close();
    await t.fileReport();
    t.reopen();
    unwrap(await bookEntry(t.f.deps, t.f.ctx, { entryDate: '2025-11-02', text: 'Nachbuchung', moneyLines: [{ accountId: t.f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: t.f.donations.id, amountCents: 700 }] }));
    unwrap(await bookEntry(t.f.deps, t.f.ctx, { entryDate: '2025-11-03', text: 'Nachbuchung', moneyLines: [{ accountId: t.f.bank.id, amountCents: 800 }], allocationLines: [{ categoryId: t.f.donations.id, amountCents: 800 }] }));
    t.close();
    let s = await t.status();
    expect(t.step(s, 'auditReport')).toMatchObject({ done: false, facts: { followUpOpen: true, changedEntries: 2, afterAssembly: false, followUpReportId: null, statementsMissing: [{ accountId: t.f.bank.id, name: 'Vereinskonto' }] } });
    expect(s.toRepeat).toEqual(['auditPackage', 'auditReport']);
    unwrap(await saveAssemblyResult(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    const draft = unwrap(await createAuditReportDraft(t.f.deps, t.mira.ctx, { fiscalYearId: t.y2025, kind: 'followUp' }));
    s = await t.status();
    expect(t.step(s, 'auditReport').facts).toMatchObject({ afterAssembly: true, followUpReportId: draft.id, followUpReadyToSign: false });
  });

  it('a follow-up without a changed entry is only confirmed; a later change opens it again (Befund 3)', async () => {
    const t = await setup();
    t.close();
    await t.fileReport();
    await t.finalizeAssemblyReports();
    t.reopen();
    t.close();
    let s10 = t.step(await t.status(), 'auditReport');
    expect(s10).toMatchObject({ done: false, confirmable: true, facts: { followUpOpen: true, changedEntries: 0 } });
    // Schritt 9 nennt Tag und Stand des Prüfpakets — ohne Lauf den Prüfstand des abgelegten Berichts (14d).
    expect(t.step(await t.status(), 'auditPackage').facts).toMatchObject({ package: { at: expect.any(String), shortHash: expect.stringMatching(/^[0-9a-f]{8}$/) } });
    // Solange die Nachprüfung offen ist, bietet „Berichte“ keine Freigabe an, und der Dienst lehnt sie ab (279 Telefon).
    expect(unwrap(await listFinanceReports(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025 })).followUp).toBe('unchanged');
    const refused = await releaseReportsForFinalizing(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, basis: 'other', note: 'umgehen' });
    expect(refused.ok ? 'ok' : (refused.error as { code?: string }).code).toBe('releaseFollowUpOpen');
    t.f.deps.clock.advance(60_000);
    // Ohne Begründung: den Befund liefert Kompass (Board 14d B).
    unwrap(await confirmClosingStep(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, step: 'auditReport' }));
    expect(unwrap(await listFinanceReports(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025 })).followUp).toBeNull();
    expect(followUpOpenInternal(t.f.deps.db, t.y2025)).toBe(false);
    // Der Prüfbericht gilt weiter: wieder freigegeben mit dem abgelegten Bericht, die Berichte lassen sich festschreiben.
    expect(t.step(await t.status(), 'auditReport').facts).toMatchObject({ release: { basis: 'auditReport' } });
    // Designer Runde 8, 347: „Berichte“ nennt den geltenden Prüfbericht und die Bestätigung der Nachprüfung — nicht den
    // Tag der neuen Freigabe als Tag des Prüfberichts.
    const audit = unwrap(await listFinanceReports(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025 })).releaseAudit!;
    expect(audit).toMatchObject({ reportFiledAt: expect.any(String), followUpConfirmedAt: expect.any(String) });
    expect(audit.reportFiledAt! < audit.followUpConfirmedAt!).toBe(true);
    // Dieselbe Bestätigung im Kopf der Kassenprüfung (346).
    expect(unwrap(await getAuditStatus(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025 })).followUpConfirmedAt).toBe(audit.followUpConfirmedAt);
    await t.finalizeAssemblyReports();
    s10 = t.step(await t.status(), 'auditReport');
    expect(s10).toMatchObject({ done: true, facts: { followUpOpen: false } });
    // Eine neue Änderung nach der Bestätigung: Nachprüfung wieder offen, mit geänderter Buchung nicht bestätigbar.
    t.reopen();
    unwrap(await bookEntry(t.f.deps, t.f.ctx, { entryDate: '2025-11-02', text: 'Nachbuchung', moneyLines: [{ accountId: t.f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: t.f.donations.id, amountCents: 700 }] }));
    t.close();
    expect(followUpOpenInternal(t.f.deps.db, t.y2025)).toBe(true);
    expect(t.step(await t.status(), 'auditReport')).toMatchObject({ done: false, confirmable: false, facts: { followUpOpen: true, changedEntries: 1 } });
    expect(unwrap(await listFinanceReports(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025 })).followUp).toBe('changed');
  });

  it('step 11 follows the assembly result, step 12 its confirmation; a postponed discharge moves on to step 12; all twelve done ends with next null', async () => {
    const t = await setup();
    const { f, y2025 } = t;
    unwrap(await setAccountActive(f.deps, f.ctx, { id: f.cash.id, isActive: false, expectedVersion: f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.cash.id)).get()!.updatedAt }));
    unwrap(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y2025, step: 'statements' }));
    t.close();
    unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'noAuditProvided', note: 'keine Prüfung' }));
    await t.finalizeAssemblyReports();
    // Ohne gespeichertes Ergebnis ist Schritt 11 der nächste.
    let s = await t.status();
    expect(s.next).toBe('assembly');
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'postponed' }));
    s = await t.status();
    expect(t.step(s, 'assembly')).toMatchObject({ done: false, facts: { result: { complete: false } } });
    expect(s.steps[10]!.done).toBe(false);
    // Vertagt sperrt nichts (Befund 2, Joe 2026-10-25): Schritt 12 kommt dran, Schritt 11 bleibt offen.
    expect(s.next).toBe('taxReturn');
    expect(t.step(s, 'taxReturn')).toMatchObject({ done: false, confirmable: true });
    unwrap(await confirmClosingStep(f.deps, f.ctx, { fiscalYearId: y2025, step: 'taxReturn', note: 'Erklärung für dieses Jahr nicht fällig' }));
    expect((await t.status()).next).toBe('assembly');
    f.deps.clock.advance(60_000);
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    s = await t.status();
    expect(s.steps.filter((x) => !x.done).map((x) => x.key)).toEqual([]);
    expect(s).toMatchObject({ doneCount: 12, next: null, reopened: null, toRepeat: [] });
  });

  it('after reopening, the hint stays until steps 8 to 10 are done again', async () => {
    const t = await setup();
    t.close();
    t.reopen();
    t.close();
    unwrap(await releaseReportsForFinalizing(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, basis: 'noAuditProvided', note: 'keine Prüfung' }));
    expect((await t.status())).toMatchObject({ toRepeat: ['auditReport'], reopened: { reason: 'Fehlbuchung' } });
    await t.finalizeAssemblyReports();
    expect((await t.status())).toMatchObject({ toRepeat: [], reopened: null });
  });
});

describe('Schritt 12 nennt die Umsatzsteuer-Jahreserklärung (Plan E6a Task 6)', () => {
  const vatFact = async (f: Awaited<ReturnType<typeof ledgerFixture>>, fiscalYearId: string) => {
    const s = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId }));
    const facts = s.steps.find((x) => x.key === 'taxReturn')!.facts as { vat: unknown };
    return facts.vat;
  };

  it('names the calendar year whose 31 December lies in the fiscal year', async () => {
    const f = await ledgerFixture({ years: ['2026'], entrepreneur: true });
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-05-12', text: 'Werbung', moneyLines: [{ accountId: f.bank.id, amountCents: -20000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -20000, taxCode: 'rc13bEu' }] }));
    expect(await vatFact(f, f.year.id)).toEqual({ calendarYear: 2026, dueOn: '2027-08-02', filedOn: null, reason: 'section18_4a', overdue: false });
  });

  it('takes the earlier calendar year for a fiscal year from July, and none for a short year without 31 December', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2025-07-01', endsOn: '2026-06-30' }));
    const costs = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'program-costs')).get()!;
    unwrap(await bookEntry(deps, ctx, { entryDate: '2025-11-15', text: 'Software', moneyLines: [{ accountId: bank.id, amountCents: -4900 }], allocationLines: [{ categoryId: costs.id, amountCents: -4900, taxCode: 'rc13bOther' }] }));
    expect(await vatFact({ deps, ctx } as never, year.id)).toEqual({ calendarYear: 2025, dueOn: '2026-07-31', filedOn: null, reason: 'section18_4a', overdue: true });
    const short = setupFinance();
    short.deps.db.transaction((tx) => installFinance(tx, short.deps, systemContext()));
    const shortYear = unwrap(await createFirstFiscalYear(short.deps, short.ctx, { startsOn: '2026-01-01', endsOn: '2026-06-30' }));
    expect(await vatFact(short as never, shortYear.id)).toBeNull();
  });

  it('gives the reason: regular taxation or reverse charge (Task 11d)', async () => {
    const f = await ledgerFixture({ years: ['2026'] });
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    expect(await vatFact(f, f.year.id)).toMatchObject({ calendarYear: 2026, reason: 'regular' });
  });
});

describe('Schritt 13 Mittelverwendung festschreiben — nur über der Grenze (M2 Task 1)', () => {
  async function setup13(cents: number) {
    const f = await ledgerFixture({ years: ['2024', '2025'] });
    const y2025 = f.years['2025']!.id;
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }));
    const status = async () => unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    const reopen = () => {
      f.deps.clock.advance(60_000);
      unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y2025, note: 'Fehlbuchung' })));
    };
    return { f, y2025, status, reopen };
  }

  it('step 13 appears only above the limit', async () => {
    const at = await setup13(4_500_000);
    const atLimit = await at.status();
    expect(atLimit.steps.map((s) => s.key)).not.toContain('fundsUse');
    expect(atLimit.steps).toHaveLength(12);
    const above = await setup13(4_500_001);
    const s = await above.status();
    expect(s.steps).toHaveLength(13);
    const last = s.steps.at(-1)!;
    expect(last).toMatchObject({ key: 'fundsUse', number: 13, group: 'after', confirmable: false, done: false, confirmation: null });
    expect(last.facts).toMatchObject({ key: 'fundsUse', revenueCents: 4_500_001, limitCents: 4_500_000, stage: 'preliminary', finalVersion: null, shortHash: expect.stringMatching(/^[0-9a-f]{7,}$/) });
  });

  it('done once the report is final; reopening puts it back to repeat', async () => {
    const t = await setup13(5_000_000);
    t.f.closeYear(t.f.years['2024']!.id);
    t.f.closeYear(t.y2025);
    // Der Schritt kennt die Sperre des Festschreibens vorher (U2-Nachzug): hier fehlt der Auszug zum Stichtag.
    expect((await t.status()).steps.at(-1)).toMatchObject({ key: 'fundsUse', done: false, facts: { stage: 'review', finalizeBlock: { code: 'reportStatementsMissing' } } });
    // Ohne Freigabe der Kassenprüfung (Gruppe Finanzamt); der Auszug zum Stichtag liegt.
    unwrap(await fileAccountStatementDocument(t.f.deps, t.f.ctx, { accountId: t.f.bank.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
    expect((await t.status()).steps.at(-1)).toMatchObject({ facts: { finalizeBlock: null } });
    const done = unwrap(await finalizeFinanceReport(t.f.deps, t.f.ctx, { report: 'fundsUse', params: { fiscalYearId: t.y2025 } }));
    const s = await t.status();
    const step13 = s.steps.at(-1)!;
    expect(step13).toMatchObject({ key: 'fundsUse', done: true, facts: { stage: 'final', finalVersion: { documentNumber: done.documentNumber } } });
    t.reopen();
    const after = await t.status();
    expect(after.toRepeat).toContain('fundsUse');
    expect(after.steps.find((x) => x.key === 'fundsUse')!.done).toBe(false);
  });

  it('reopening lists an open step 13 to repeat', async () => {
    const t = await setup13(5_000_000);
    t.f.closeYear(t.f.years['2024']!.id);
    t.f.closeYear(t.y2025);
    t.reopen();
    const s = await t.status();
    expect(s.toRepeat).toContain('fundsUse');
    expect(s.steps.find((x) => x.key === 'fundsUse')!.done).toBe(false);
  });

  it('step 13 is not confirmable', async () => {
    const t = await setup13(5_000_000);
    const r = await confirmClosingStep(t.f.deps, t.f.ctx, { fiscalYearId: t.y2025, step: 'fundsUse', note: 'erledigt' });
    expect(r.ok ? 'ok' : r.error.type).toBe('validation');
  });
});
