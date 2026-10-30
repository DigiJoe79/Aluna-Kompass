import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { withTestReports } from '../src/reporting/catalog';
import { listFinanceReports, runFinanceReport } from '../src/reporting/service';
import { ledgerFixture } from './helpers';
import { testReport } from './reporting-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('runFinanceReport and listFinanceReports (Rechenschaft A1 Task 4)', () => {
  it('derives the stage from the year', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    await withTestReports([testReport()], async () => {
      const open = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: f.years['2026']!.id } }));
      expect(open.stage).toBe('preliminary');
      expect(open.shortHash).toHaveLength(8);
      expect(open.released).toBeNull();
      f.closeYear(f.years['2025']!.id);
      const closed = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: f.years['2025']!.id } }));
      expect(closed.stage).toBe('review');
      expect(closed.data).toEqual({ lines: 0, totalCents: 0 }); // Jahr ohne Buchungen: leere Daten, stabiler Hash
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: { fiscalYearId: f.years['2025']!.id } })).hash).toBe(closed.hash);
    });
  });

  it('follows the youngest year of a report over several years, and reviews only when all are closed', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const multi = testReport({ key: 'testMulti', years: (_db, params) => params.fiscalYearIds ?? [], compute: () => ({ lines: 0, totalCents: 0 }), paramsSchema: z.object({ fiscalYearIds: z.array(z.string()).min(1) }) });
    await withTestReports([multi], async () => {
      const params = { fiscalYearIds: [f.years['2025']!.id, f.years['2026']!.id] };
      f.closeYear(f.years['2025']!.id);
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testMulti', params })).stage).toBe('preliminary');
      f.closeYear(f.years['2026']!.id);
      expect(unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testMulti', params })).stage).toBe('review');
    });
  });

  it('names per total the count and filter of its lines', async () => {
    const f = await ledgerFixture();
    await f.finalEntry();
    const withLines = testReport({ key: 'testLines', linesFilter: (_d, p) => ({ donations: { fiscalYearId: p.fiscalYearId, categoryId: f.donations.id } }) });
    await withTestReports([withLines], async () => {
      const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testLines', params: { fiscalYearId: f.year.id } }));
      expect(run.lines).toEqual({ donations: { count: 1, filter: { fiscalYearId: f.year.id, categoryId: f.donations.id } } });
    });
  });

  it('passes listed settings to compute', async () => {
    const f = await ledgerFixture();
    const seen: unknown[] = [];
    const withSetting = testReport({
      key: 'testSetting',
      settingKeys: ['finance.membershipFeesCertifiable'],
      compute: (_db, _p, env) => {
        seen.push(env.settings['finance.membershipFeesCertifiable']);
        return { lines: 0, totalCents: env.settings['finance.membershipFeesCertifiable'] ? 1 : 0 };
      },
    });
    await withTestReports([withSetting], async () => {
      const before = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testSetting', params: { fiscalYearId: f.year.id } }));
      expect(seen.at(-1)).toBe(true);
      f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.membershipFeesCertifiable', false));
      const after = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testSetting', params: { fiscalYearId: f.year.id } }));
      expect(seen.at(-1)).toBe(false);
      expect(after.hash).not.toBe(before.hash);
    });
  });

  it('passes no settings without settingKeys', async () => {
    const f = await ledgerFixture();
    let settings: unknown = null;
    const plain = testReport({ key: 'testPlain', compute: (_db, _p, env) => ((settings = env.settings), { lines: 0, totalCents: 0 }) });
    await withTestReports([plain], async () => {
      unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'testPlain', params: { fiscalYearId: f.year.id } }));
      expect(settings).toEqual({});
    });
  });

  it('refuses unknown and unavailable reports', async () => {
    const f = await ledgerFixture();
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'nope', params: { fiscalYearId: f.year.id } }))).toMatchObject({ code: 'reportUnknown' });
    expect(err(await runFinanceReport(f.deps, f.ctx, { report: '' }))).toMatchObject({ type: 'validation' });
    // Seit M2 ist jeder Bericht des Katalogs verfügbar; die Ablehnung prüft ein nicht verfügbarer Testbericht.
    await withTestReports([testReport({ key: 'testLater', available: false })], async () => {
      expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'testLater', params: { fiscalYearId: f.year.id } }))).toMatchObject({ code: 'reportUnavailable' });
    });
    await withTestReports([testReport()], async () => {
      expect(err(await runFinanceReport(f.deps, f.ctx, { report: 'testAssembly', params: {} }))).toMatchObject({ type: 'validation' });
    });
  });

  it('hides personal reports from overview readers', async () => {
    const f = await ledgerFixture();
    const overview = ctxWith(['finance.overview'], f.userId);
    await withTestReports([testReport(), testReport({ key: 'testPersonal', personal: true })], async () => {
      const keys = unwrap(await listFinanceReports(f.deps, overview, { fiscalYearId: f.year.id })).reports.map((r) => r.key);
      expect(keys).toContain('testAssembly');
      expect(keys).not.toContain('testPersonal');
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: f.year.id })).reports.map((r) => r.key)).toContain('testPersonal');
      expect(err(await runFinanceReport(f.deps, overview, { report: 'testPersonal', params: { fiscalYearId: f.year.id } }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
      expect(err(await runFinanceReport(f.deps, overview, { report: 'testAssembly', params: { fiscalYearId: f.year.id } }))).toBe('ok');
      expect(err(await listFinanceReports(f.deps, ctxWith([], f.userId), { fiscalYearId: f.year.id }))).toEqual({ type: 'forbidden', permission: 'finance.overview' });
    });
  });

  it('lists the catalogue; an unavailable report is greyed out without a stage', async () => {
    const f = await ledgerFixture();
    const { reports } = unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: f.year.id }));
    // M2: die Mittelverwendungsrechnung ist verfügbar.
    expect(reports.find((r) => r.key === 'fundsUse')).toMatchObject({ key: 'fundsUse', available: true, group: 'taxOffice', stage: 'preliminary', lastFinal: [] });
    await withTestReports([testReport({ key: 'testLater', available: false })], async () => {
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: f.year.id })).reports.find((r) => r.key === 'testLater')).toMatchObject({ available: false, stage: null, lastFinal: [] });
    });
    await withTestReports([testReport()], async () => {
      expect(unwrap(await listFinanceReports(f.deps, f.ctx, { fiscalYearId: f.year.id })).reports.find((r) => r.key === 'testAssembly')).toMatchObject({ stage: 'preliminary', lastFinal: [] });
    });
  });
});
