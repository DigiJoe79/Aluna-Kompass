import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { recordNameConsent } from '../src/allocation/name-consents';
import { publishAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { readFinanceReportDocument } from '../src/reporting/finalize';
import { listFinanceReportVersions, runFinanceReport } from '../src/reporting/service';
import { financeAnnualAccountsPublications, financeReportSignatures } from '../src/schema';
import { finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

/**
 * Bildabnahme 0.4.5 F-3: Nach der Abzeichnung zeigt die Berichtsseite die abgezeichnete Fassung (die publiziert wird),
 * eine Webfassung steht als eigene Zeile unter „Festgeschriebene Fassungen“.
 */
describe('Jahresrechnung: gezeigte Fassung nach der Abzeichnung', () => {
  it('vor der Abzeichnung die festgeschriebene, danach die abgezeichnete — mit ihrer Nummer', async () => {
    const s = await finalizedAnnualAccounts();
    const before = unwrap(await runFinanceReport(s.f.deps, s.f.ctx, { report: 'annualAccounts', params: s.params }));
    expect(before.finalVersion).toMatchObject({ reportId: s.report.id, signedCopy: null });
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    const sig = s.f.deps.db.select().from(financeReportSignatures).get()!;
    const after = unwrap(await runFinanceReport(s.f.deps, s.f.ctx, { report: 'annualAccounts', params: s.params }));
    expect(after.finalVersion).toMatchObject({ reportId: s.report.id, documentNumber: s.report.documentNumber, signedCopy: { documentId: sig.documentId, documentNumber: sig.documentNumber } });
  });

  it('liest die abgezeichnete Fassung und die Webfassung über den Bericht, kein fremdes Dokument', async () => {
    const s = await finalizedAnnualAccounts();
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
    unwrap(await recordNameConsent(s.f.deps, ctxWith(['finance.entriesWrite'], s.f.userId), { kind: 'revoked', contactId: s.donor.id, on: '2026-09-05' }));
    const sig = s.f.deps.db.select().from(financeReportSignatures).get()!;
    const pub = s.f.deps.db.select().from(financeAnnualAccountsPublications).get()!;
    expect(pub.webDocumentId).not.toBeNull();
    const own = unwrap(await readFinanceReportDocument(s.f.deps, s.f.ctx, { reportId: s.report.id }));
    const signed = unwrap(await readFinanceReportDocument(s.f.deps, s.f.ctx, { reportId: s.report.id, documentId: sig.documentId }));
    const web = unwrap(await readFinanceReportDocument(s.f.deps, s.f.ctx, { reportId: s.report.id, documentId: pub.webDocumentId! }));
    expect(new Set([own.filename, signed.filename, web.filename]).size).toBe(3);
    const foreign = await readFinanceReportDocument(s.f.deps, s.f.ctx, { reportId: s.report.id, documentId: s.report2024?.documentId ?? 'unbekannt' });
    expect(foreign.ok ? 'ok' : foreign.error.type).toBe('notFound');

    const listed = unwrap(await listFinanceReportVersions(s.f.deps, s.f.ctx, { report: 'annualAccounts', params: s.params }));
    expect(listed.versions[0]!.copies).toEqual([
      { kind: 'signed', documentId: sig.documentId, documentNumber: sig.documentNumber, on: sig.signedOn },
      { kind: 'web', documentId: pub.webDocumentId, documentNumber: pub.webDocumentNumber, on: pub.webVersionOn },
    ]);
  });

  it('andere Berichte haben keine Kopien', async () => {
    const s = await finalizedAnnualAccounts();
    const listed = unwrap(await listFinanceReportVersions(s.f.deps, s.f.ctx, { report: 'cashReport', params: s.params }));
    expect(listed.versions[0]!.copies).toEqual([]);
    const run = unwrap(await runFinanceReport(s.f.deps, s.f.ctx, { report: 'cashReport', params: s.params }));
    expect(run.finalVersion?.signedCopy).toBeNull();
  });
});
