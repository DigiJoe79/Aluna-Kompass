import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createOpenItem, createOriginOpenItem, updateOpenItem } from '../src/ledger/open-items';
import { ledgerFixture } from './helpers';

/**
 * Rechenschaft D1 Task 10b (Befund A3): Ein abgeschlossenes Jahr ändert sich nicht — auch nicht über offene Zahlungen,
 * die der Kassenbericht zum Jahresende zeigt.
 */
describe('offene Zahlungen im abgeschlossenen Jahr', () => {
  it('refuses to create or move an open item into a closed fiscal year', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const before = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2025-11-01', amountCents: 1000 }));
    f.closeYear(f.years['2025']!.id);
    expect(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2025-12-01', amountCents: 1000 })).toMatchObject({ ok: false, error: { code: 'fiscalYearClosed', params: { year: '2025' } } });
    const open = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-02-01', amountCents: 1000 }));
    expect(await updateOpenItem(f.deps, f.ctx, { id: open.id, itemDate: '2025-12-31' })).toMatchObject({ ok: false, error: { code: 'fiscalYearClosed' } });
    expect(await updateOpenItem(f.deps, f.ctx, { id: before.id, amountCents: 2000 })).toMatchObject({ ok: false, error: { code: 'fiscalYearClosed' } });
    const origin = f.deps.db.transaction((tx) => createOriginOpenItem(tx, f.deps, f.ctx, { originType: 'unknownOrigin', originId: 'x', contactId: f.donor.id, amountCents: 100, itemDate: '2025-12-01', dueOn: '2026-01-01', paymentReference: null, lineTemplate: [] }));
    expect(origin).toMatchObject({ ok: false, error: { code: 'fiscalYearClosed' } });
  });
});
