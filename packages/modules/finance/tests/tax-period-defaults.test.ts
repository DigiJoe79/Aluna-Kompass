import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createTaxPeriod, taxPeriodDefaults, taxPeriodStatute } from '../src/ledger/tax-periods';
import { ctxWith } from '@kompass/core/testing';
import { registerStatuteSource, type StatuteSuggestion } from '../src/sources';
import { ledgerFixture } from './helpers';

/** Die Testquelle merkt sich den Stichtag und liefert, was `current` sagt — `null` heißt „Gremien aus“. */
let current: StatuteSuggestion | null = null;
const asked: string[] = [];
registerStatuteSource((_deps, _db, on) => {
  asked.push(on);
  return current;
});

const suggestion: StatuteSuggestion = { statuteDate: '2026-09-05', documentId: 'DOC-S', source: { label: 'Satzung vom 05.09.2026', href: '/governance/statutes/S1' } };

describe('statute date for Anlage Gem from Gremien (G7)', () => {
  it('suggests the statute valid at the end of the next period; without a source: null', async () => {
    current = null;
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    expect(unwrap(await taxPeriodDefaults(f.deps, f.ctx, {}))!.statute).toBeNull();
    current = suggestion;
    asked.length = 0;
    expect(unwrap(await taxPeriodDefaults(f.deps, f.ctx, {}))!.statute).toEqual({ date: '2026-09-05', documentId: 'DOC-S', source: { label: 'Satzung vom 05.09.2026', href: '/governance/statutes/S1' } });
    expect(asked).toEqual(['2026-12-31']);
  });

  it('for an existing period: the statute valid at its end', async () => {
    current = suggestion;
    const f = await ledgerFixture({ years: ['2024', '2025', '2026'] });
    const period = unwrap(await createTaxPeriod(f.deps, f.ctx, { firstFiscalYearId: f.years['2024']!.id, lastFiscalYearId: f.years['2025']!.id, withTaxAdvisor: false, dueOn: '2026-07-31' }));
    asked.length = 0;
    expect(unwrap(await taxPeriodStatute(f.deps, f.ctx, { taxPeriodId: period.id }))).toMatchObject({ date: '2026-09-05', documentId: 'DOC-S' });
    expect(asked).toEqual(['2025-12-31']);
    expect(await taxPeriodStatute(f.deps, f.ctx, { taxPeriodId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await taxPeriodStatute(f.deps, ctxWith(['finance.overview'], f.userId), { taxPeriodId: period.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await taxPeriodStatute(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    current = null;
    expect(unwrap(await taxPeriodStatute(f.deps, f.ctx, { taxPeriodId: period.id }))).toBeNull();
  });
});
