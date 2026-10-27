import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createProject } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bookEntry } from '../src/ledger/finalize';
import { projectBalances } from '../src/ledger/queries';
import { runFinanceReport } from '../src/reporting/service';
import { computeProjectStatementReport, projectStatementReport } from '../src/reporting/reports/project-statement';
import { financeCategories } from '../src/schema';
import { uploadVoucher } from '../src/ledger/vouchers';
import { ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

const book = (f: Fixture, o: { date: string; key: string; cents: number; projectId?: string; text?: string; contactId?: string }) => {
  const category = f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, o.key)).get()!;
  return bookEntry(f.deps, f.ctx, {
    entryDate: o.date,
    text: o.text ?? 'Projektbuchung',
    moneyLines: [{ accountId: f.bank.id, amountCents: o.cents }],
    allocationLines: [{ categoryId: category.id, amountCents: o.cents, taxCode: 'none', ...(o.projectId ? { projectId: o.projectId } : {}), ...(o.contactId ? { contactId: o.contactId } : {}) }],
  }).then(unwrap);
};

const project = async (f: Fixture, slug: string, name: string) =>
  unwrap(await createProject(f.deps, ctxWith(['projects.manage'], f.userId), { slug, name: { de: name }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } })).id;

async function withProjects() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const p1 = await project(f, 'brunnenbau', 'Brunnenbau');
  const p2 = await project(f, 'schulgarten', 'Schulgarten');
  await book(f, { date: '2025-05-01', key: 'donations', cents: 20000, projectId: p1 });
  await book(f, { date: '2026-03-01', key: 'donations', cents: 15000, projectId: p1, text: 'Geheimer Buchungstext', contactId: f.donor.id });
  const spent = await book(f, { date: '2026-03-02', key: 'program-costs', cents: -6000, projectId: p1 });
  await book(f, { date: '2026-03-03', key: 'program-costs', cents: -2000, projectId: p2 });
  await book(f, { date: '2026-03-04', key: 'donations', cents: 999 });
  return { f, p1, p2, spent, y2025: f.years['2025']!.id, y2026: f.years['2026']!.id };
}

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('Bericht projectStatement (Rechenschaft B1 Task 3)', () => {
  it('sums per project like projectBalances, for the year and since the start', async () => {
    const { f, p1, p2, y2026 } = await withProjects();
    const data = computeProjectStatementReport(f.deps.db, { fiscalYearId: y2026 });
    const year = projectBalances(f.deps.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(data.projects.map((p) => p.projectId).sort()).toEqual([p1, p2].sort());
    for (const p of data.projects) {
      const expected = year.find((b) => b.projectId === p.projectId)!;
      expect({ incomeCents: p.incomeCents, expenseCents: p.expenseCents, resultCents: p.resultCents }).toEqual({ incomeCents: expected.incomeCents, expenseCents: expected.expenseCents, resultCents: expected.resultCents });
      expect(p.income.reduce((s, c) => s + c.sumCents, 0)).toBe(p.incomeCents);
      expect(p.expense.reduce((s, c) => s + c.sumCents, 0)).toBe(p.expenseCents);
    }
    expect(data.projects.find((p) => p.projectId === p1)!.sinceStart).toEqual({ incomeCents: 35000, expenseCents: 6000, resultCents: 29000 });
  });

  it('lists the entries with their vouchers and marks those without', async () => {
    const { f, p1, spent, y2026 } = await withProjects();
    const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: spent.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2026-03-02' }));
    const project = computeProjectStatementReport(f.deps.db, { fiscalYearId: y2026, projectId: p1 }).projects[0]!;
    expect(project.entries).toHaveLength(2);
    expect(project.entries.find((e) => e.entryId === spent.id)).toMatchObject({ amountCents: -6000, documentNumbers: [voucher.documentNumber], withoutVoucher: false });
    expect(project.entries.find((e) => e.entryId !== spent.id)).toMatchObject({ documentNumbers: [], withoutVoucher: true });
  });

  it('keeps entry texts and contacts out of the data', async () => {
    const { f, y2026 } = await withProjects();
    const text = JSON.stringify(computeProjectStatementReport(f.deps.db, { fiscalYearId: y2026 }));
    expect(text).not.toContain('Geheimer Buchungstext');
    expect(text).not.toContain('Musterspenderin');
    expect(text).not.toContain(f.donor.id);
  });

  it('shows one project even when empty, and none without project lines', async () => {
    const { f, p2, y2025 } = await withProjects();
    expect(computeProjectStatementReport(f.deps.db, { fiscalYearId: y2025, projectId: p2 }).projects).toMatchObject([{ projectId: p2, incomeCents: 0, expenseCents: 0, entries: [] }]);
    const empty = await ledgerFixture();
    const run = unwrap(await runFinanceReport(empty.deps, empty.ctx, { report: 'projectStatement', params: { fiscalYearId: empty.year.id } }));
    expect(run.data).toMatchObject({ projects: [] });
    expect(run.stage).toBe('preliminary');
  });

  it('refuses an unknown project before computing', async () => {
    const { f, y2026 } = await withProjects();
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'projectStatement', params: { fiscalYearId: y2026, projectId: 'nope' } }))).toEqual({ type: 'notFound', entity: 'project', id: 'nope' });
  });

  it('is readable with finance.overview and names lines per project', async () => {
    const { f, p1, y2026 } = await withProjects();
    const run = unwrap(await runFinanceReport(f.deps, ctxWith(['finance.overview'], f.userId), { report: 'projectStatement', params: { fiscalYearId: y2026 } }));
    expect(run.lines![`${p1}.income`]).toEqual({ count: 1, filter: { fiscalYearId: y2026, projectId: p1, direction: 'income' } });
    expect(projectStatementReport.linesFilter!(run.data as never, { fiscalYearId: y2026 })[`${p1}.expense`]).toEqual({ fiscalYearId: y2026, projectId: p1, direction: 'expense' });
  });
});
