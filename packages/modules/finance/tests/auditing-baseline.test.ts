import { unwrap } from '@kompass/core';
import { auditEntry } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveAuditor } from '../src/auditing/auditors';
import { REPORT_CATALOG } from '../src/reporting/catalog';
import { baselineReportRefs, baselinesOfYearInternal, changedSinceInternal, entryFingerprintInternal, referenceBaselineInternal } from '../src/auditing/baseline';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { bookEntry } from '../src/ledger/finalize';
import { closeFiscalYear, closeInternal, reopenInternal } from '../src/ledger/period';
import { reverseEntry } from '../src/ledger/reverse';
import { revokeVoucher, uploadVoucher } from '../src/ledger/vouchers';
import { financeAllocationLines, financeFiscalYears } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

const setup = async () => {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const row = () => f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y2025)).get()!;
  const close = () => unwrap(f.deps.db.transaction((tx) => closeInternal(tx, f.deps, f.ctx, row())));
  const reopen = () => unwrap(f.deps.db.transaction((tx) => reopenInternal(tx, f.deps, f.ctx, { id: y2025, note: 'Fehler gefunden' })));
  const book = async (date: string, cents: number, contactId?: string) =>
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents, ...(contactId ? { contactId } : {}) }] }));
  return { f, y2025, close, reopen, book };
};

describe('Prüfstand beim Abschluss', () => {
  it('closeFiscalYear creates exactly one initial baseline with report hashes and a fingerprint per entry', async () => {
    const { f, y2025 } = await setup();
    unwrap(await closeFiscalYear(f.deps, f.ctx, { id: y2025 }));
    const baselines = baselinesOfYearInternal(f.deps.db, y2025);
    expect(baselines.map((b) => b.kind)).toEqual(['initial']);
    const refs = baselineReportRefs(baselines[0]!);
    const expected = REPORT_CATALOG.filter((d) => d.available && (d.group === 'assembly' || d.group === 'audit') && d.paramsSchema.safeParse({ fiscalYearId: y2025 }).success).map((d) => d.key);
    expect(refs.map((r) => r.key).sort()).toEqual(expected.sort());
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatchObject({ params: { fiscalYearId: y2025 }, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(auditEntry(f.deps, 'finance.audit.baseline.create')).toMatchObject({ entityId: baselines[0]!.id });
  });

  it('after reopening without a filed report the draft keeps the first baseline; changes count against it', async () => {
    const { f, y2025, close, reopen, book } = await setup();
    const a = await book('2025-02-01', 1000, f.wrongDonor.id);
    const c = await book('2025-03-01', 2000);
    const d = await book('2025-04-01', 3000);
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: d.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-04-01' }));
    const untouched = await book('2025-05-01', 4000);
    close();
    const [first] = baselinesOfYearInternal(f.deps.db, y2025);
    expect(changedSinceInternal(f.deps.db, y2025, first!.id)).toEqual([]);
    const fingerprint = entryFingerprintInternal(f.deps.db, untouched.id);

    reopen();
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, a.id)).get()!;
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    unwrap(await reverseEntry(f.deps, f.ctx, { id: c.id }));
    unwrap(await revokeVoucher(f.deps, f.ctx, { linkId: voucher.linkId, note: 'Falscher Beleg' }));
    const added = await book('2025-06-01', 500);
    close();

    expect(baselinesOfYearInternal(f.deps.db, y2025).map((b) => b.kind)).toEqual(['initial']);
    expect(referenceBaselineInternal(f.deps.db, y2025)).toBe(first!.id);
    const changed = changedSinceInternal(f.deps.db, y2025, first!.id);
    expect(changed).toEqual(expect.arrayContaining([a.id, c.id, d.id, added.id]));
    expect(changed).not.toContain(untouched.id);
    expect(entryFingerprintInternal(f.deps.db, untouched.id)).toBe(fingerprint);
  });

  // N13 (MCP-Nachttest 0.4.0): Was den Fingerabdruck der Umsatzsteuer ändert (Kennzeichen, Satz, Betrag,
  // Entstehungstag aus Buchungstag und Leistungstag), ändert auch den der Kassenprüfung — sonst fehlte in der
  // Nachprüfung eine Änderung, die eine Berichtigung beim Finanzamt auslöst.
  it('a changed service date counts as a change, like for the VAT fingerprint', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'], entrepreneur: true });
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-10-14', text: 'Werbung', moneyLines: [{ accountId: f.bank.id, amountCents: -15000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -15000, taxCode: 'rc13bEu' }] }));
    const before = entryFingerprintInternal(f.deps.db, entry.id);
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: entry.allocationLines[0]!.id, changes: { serviceDate: '2025-10-10' }, note: 'Leistungstag nachgetragen' }));
    expect(entryFingerprintInternal(f.deps.db, entry.id)).not.toBe(before);
  });

  it('a year closed before D1 gets its baseline with the first auditor', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    expect(baselinesOfYearInternal(f.deps.db, y2025)).toEqual([]);
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: f.donor.id, mode: 'paper' }));
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: f.rightDonor.id, mode: 'paper' }));
    expect(baselinesOfYearInternal(f.deps.db, y2025).map((b) => b.kind)).toEqual(['initial']);
  });

  it('cannot be changed or deleted', async () => {
    const { f, y2025, close, book } = await setup();
    await book('2025-02-01', 1000);
    close();
    const [b] = baselinesOfYearInternal(f.deps.db, y2025);
    expect(() => f.deps.sqlite.prepare('update finance_audit_baselines set kind = ? where id = ?').run('followUp', b!.id)).toThrow(/immutable/);
    expect(() => f.deps.sqlite.prepare('delete from finance_audit_baselines where id = ?').run(b!.id)).toThrow(/permanent/);
    expect(() => f.deps.sqlite.prepare('update finance_audit_baseline_entries set fingerprint = ?').run('x')).toThrow(/immutable/);
    expect(() => f.deps.sqlite.prepare('delete from finance_audit_baseline_entries').run()).toThrow(/permanent/);
  });
});
