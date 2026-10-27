import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { confirmAccountForYear, fileAccountStatementDocument } from '../src/ledger/statement-documents';
import { withTestReports } from '../src/reporting/catalog';
import { finalizeFinanceReport, previewFinanceReport, releaseReportsForFinalizing } from '../src/reporting/finalize';
import { listFinanceReports, runFinanceReport } from '../src/reporting/service';
import { ledgerFixture, pdfBytes } from './helpers';
import { testReport } from './reporting-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const REPORTS = [testReport(), testReport({ key: 'testTax', group: 'taxOffice' }), testReport({ key: 'testAudit', group: 'audit' })];

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const second = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitbank', kind: 'bank', iban: 'DE48999999990000404040' }));
  const paypal = unwrap(await createAccount(f.deps, f.ctx, { name: 'Bezahldienst', kind: 'paymentService' }));
  for (const accountId of [second.id, paypal.id]) unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-06-01', text: 'Spende', moneyLines: [{ accountId, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000 }] }));
  f.closeYear(y2025);
  return { f, y2025, second, paypal };
}

describe('Festschreiben wartet auf die Kontoauszüge (Rechenschaft C Schritt 1)', () => {
  it('blocks finalizing until the statements are there — after the release', async () => {
    const { f, y2025, second } = await setup();
    await withTestReports(REPORTS, async () => {
      const params = { fiscalYearId: y2025 };
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }))).toMatchObject({ code: 'reportNotReleased' });
      unwrap(await releaseReportsForFinalizing(f.deps, f.ctx, { fiscalYearId: y2025, basis: 'oralReport', note: null }));
      const missing = { code: 'reportStatementsMissing', params: { designation: '2025', accounts: 'Zweitbank', count: 1 } };
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }))).toMatchObject(missing);
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params })).finalizeBlock).toEqual(missing);
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params }))).toMatchObject(missing);
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 })).statementsMissing).toEqual([{ accountId: second.id, name: 'Zweitbank' }]);

      unwrap(await fileAccountStatementDocument(f.deps, f.ctx, { accountId: second.id, periodTo: '2025-12-31', bytes: pdfBytes() }));
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: y2025 })).statementsMissing).toEqual([]);
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params }))).toBe('ok');
    });
  });

  it('a justification lifts the block too', async () => {
    const { f, y2025, second } = await setup();
    await withTestReports(REPORTS, async () => {
      unwrap(await confirmAccountForYear(f.deps, f.ctx, { fiscalYearId: y2025, accountId: second.id, kind: 'missingJustified', note: 'Bank liefert keine PDFs' }));
      expect(err(await finalizeFinanceReport(f.deps, f.ctx, { report: 'testTax', params: { fiscalYearId: y2025 } }))).toBe('ok');
    });
  });

  it('marks review versions of assembly reports as going to the assembly finalized', async () => {
    const { f, y2025 } = await setup();
    const slots: Record<string, unknown>[] = [];
    const original = f.deps.documents.render.bind(f.deps.documents);
    f.deps.documents.render = async (args) => {
      slots.push(args.slots as unknown as Record<string, unknown>);
      return original(args);
    };
    await withTestReports(REPORTS, async () => {
      unwrap(await previewFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: y2025 } }));
      unwrap(await previewFinanceReport(f.deps, f.ctx, { report: 'testAudit', params: { fiscalYearId: y2025 } }));
    });
    expect(slots.map((s) => s.stageText)).toEqual(['Zur Prüfung – wird der Mitgliederversammlung nach Abschluss der Prüfung festgeschrieben vorgelegt', 'Zur Prüfung – noch nicht festgeschrieben']);
  });
});
