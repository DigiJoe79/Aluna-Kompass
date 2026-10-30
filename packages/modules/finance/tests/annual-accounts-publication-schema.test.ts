import { newId, readSetting } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';
import { financeAnnualAccountsPublications, financeFiscalYears, financeReports, financeReportSignatures } from '../src/schema';
import { setupFinance } from './helpers';

/** Der mechanische Wächter des Schemas von Abzeichnung und Veröffentlichung der Jahresrechnung (J2 Task 1). */
const AT = '2027-02-27T09:00:00.000Z';

function withReport() {
  const { deps } = setupFinance();
  const fiscalYearId = newId();
  deps.db.insert(financeFiscalYears).values({ id: fiscalYearId, designation: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', createdAt: AT, updatedAt: AT }).run();
  const reportId = newId();
  deps.db
    .insert(financeReports)
    .values({ id: reportId, reportKey: 'annualAccounts', params: '{}', fiscalYearId, dataHash: 'h', documentId: 'D1', documentNumber: 'FB-2027-0001', finalizedAt: AT, finalizedByUserId: 'U1' })
    .run();
  return { deps, fiscalYearId, reportId };
}

const publication = (reportId: string, fiscalYearId: string) => ({ id: newId(), reportId, fiscalYearId, publishedAt: AT, publishedByUserId: 'U1', corrected: false });

describe('Schema von Abzeichnung und Veröffentlichung', () => {
  it('hält je Fassung genau eine Abzeichnung, nur anhängen', () => {
    const { deps, reportId } = withReport();
    const id = newId();
    const row = { id, reportId, contactId: 'C1', signerName: 'Vera Vorstand', signerOffice: 'Vorsitzende', via: 'account' as const, signerUserId: 'U2', signedOn: '2027-02-27', documentId: 'D2', documentNumber: 'FB-2027-0002', scanDocumentId: null, namedContactIds: '["C9"]', createdAt: AT, createdByUserId: 'U2' };
    deps.db.insert(financeReportSignatures).values(row).run();
    expect(deps.db.select().from(financeReportSignatures).where(eq(financeReportSignatures.id, id)).get()).toEqual(row);
    expect(() => deps.db.insert(financeReportSignatures).values({ ...row, id: newId() }).run()).toThrow(/UNIQUE/);
    expect(() => deps.db.update(financeReportSignatures).set({ signerName: 'Andere' }).where(eq(financeReportSignatures.id, id)).run()).toThrow(/permanent/);
    expect(() => deps.db.delete(financeReportSignatures).where(eq(financeReportSignatures.id, id)).run()).toThrow(/permanent/);
  });

  it('erlaubt je Fassung nur eine laufende Veröffentlichung; nach dem Zurücknehmen eine neue', () => {
    const { deps, reportId, fiscalYearId } = withReport();
    const first = publication(reportId, fiscalYearId);
    deps.db.insert(financeAnnualAccountsPublications).values({ ...first, earlyReason: 'itzDeadline', earlyNote: 'Frist' }).run();
    expect(deps.db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, first.id)).get()).toMatchObject({
      earlyReason: 'itzDeadline', earlyNote: 'Frist', corrected: false, replacesFinalizedAt: null, webDocumentId: null, webDocumentNumber: null, webVersionOn: null, withdrawnAt: null, withdrawnByUserId: null, withdrawnCause: null,
    });
    expect(() => deps.db.insert(financeAnnualAccountsPublications).values(publication(reportId, fiscalYearId)).run()).toThrow(/UNIQUE/);
    deps.db.update(financeAnnualAccountsPublications).set({ withdrawnAt: AT, withdrawnByUserId: 'U1', withdrawnCause: 'manual' }).where(eq(financeAnnualAccountsPublications.id, first.id)).run();
    deps.db.insert(financeAnnualAccountsPublications).values(publication(reportId, fiscalYearId)).run();
    expect(deps.db.select().from(financeAnnualAccountsPublications).all()).toHaveLength(2);
  });

  it('lässt an einer Veröffentlichung nur Webfassung und Zurücknehmen ändern, nie löschen', () => {
    const { deps, reportId, fiscalYearId } = withReport();
    const row = publication(reportId, fiscalYearId);
    deps.db.insert(financeAnnualAccountsPublications).values(row).run();
    deps.db.update(financeAnnualAccountsPublications).set({ webDocumentId: 'D3', webDocumentNumber: 'FB-2027-0003', webVersionOn: '2027-04-01' }).where(eq(financeAnnualAccountsPublications.id, row.id)).run();
    expect(() => deps.db.update(financeAnnualAccountsPublications).set({ publishedAt: '2027-01-01T00:00:00.000Z' }).where(eq(financeAnnualAccountsPublications.id, row.id)).run()).toThrow(/permanent/);
    deps.db.update(financeAnnualAccountsPublications).set({ withdrawnAt: AT, withdrawnByUserId: 'U1', withdrawnCause: 'manual' }).where(eq(financeAnnualAccountsPublications.id, row.id)).run();
    expect(() => deps.db.update(financeAnnualAccountsPublications).set({ withdrawnCause: 'voided' }).where(eq(financeAnnualAccountsPublications.id, row.id)).run()).toThrow(/permanent/);
    expect(() => deps.db.delete(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, row.id)).run()).toThrow(/permanent/);
  });

  it('kennt die Einstellung „MV genehmigt die Jahresrechnung“ (Vorgabe aus) und führt beide als unlöschbar', () => {
    const { deps } = withReport();
    expect(readSetting<boolean>(deps, 'finance.reports.assemblyApprovesAccounts')).toBe(false);
    const rules = financeModule.deletionRules ?? [];
    expect(rules.find((r) => r.entity === 'financeReportSignature')?.deletable).toBe(false);
    expect(rules.find((r) => r.entity === 'financeAnnualAccountsPublication')?.deletable).toBe(false);
  });
});
