import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getMembersSettings, saveMembersSettings } from '../src/settings-service';
import { auditOf, setupMembers } from './helpers';

describe('members settings', () => {
  it('reads and saves notice, join year rule, payment term and levels, audited per key', async () => {
    const { deps, ctx } = setupMembers();
    const before = unwrap(await getMembersSettings(deps, ctx));
    expect(before).toMatchObject({ nextNumber: 1, joinYearRule: 'full', paymentTermDays: 14, resignationNotice: { months: 3, at: 'fiscalYearEnd' } });
    const after = unwrap(await saveMembersSettings(deps, ctx, { joinYearRule: 'proRataMonths', paymentTermDays: 21, resignationNotice: { months: 1, at: 'quarterEnd' } }));
    expect(after).toMatchObject({ joinYearRule: 'proRataMonths', paymentTermDays: 21, resignationNotice: { months: 1, at: 'quarterEnd' } });
    expect(auditOf(deps, 'members.setting.set').map((e) => e.params)).toEqual([{ key: 'members.resignationNotice' }, { key: 'members.joinYearRule' }, { key: 'members.paymentTermDays' }]);
  });

  it('needs members.fees to save and valid values', async () => {
    const { deps, ctx } = setupMembers();
    expect(await saveMembersSettings(deps, ctxWith(['members.read']), { paymentTermDays: 21 })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await saveMembersSettings(deps, ctx, { paymentTermDays: 0 })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await saveMembersSettings(deps, ctx, { dunningLevels: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
