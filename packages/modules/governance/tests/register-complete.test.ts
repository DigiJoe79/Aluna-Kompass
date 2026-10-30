import { readSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { completeRegisterFiling } from '../src/register/complete';
import { addFilingOccasions, createRegisterFiling, getRegisterFiling, updateRegisterFiling } from '../src/register/filings';
import { recordInterimOrder } from '../src/register/interim-orders';
import { getStatute, registerStatute, statuteValidOnInternal } from '../src/statutes';
import { asMcp, auditOf, RECORDING, setupGovernance } from './helpers';
import { chairResigns, statuteMeeting } from './register-helpers';

const NOW = '2026-09-20T08:00:00.000Z';

describe('completeRegisterFiling', () => {
  it('Aluna: initial filing with interim order, a statute change joins it, registration makes the second stand valid; the founding stand never is', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2026-07-20', { founding: true });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-07-22', submittedOn: '2026-07-24' }));
    unwrap(await recordInterimOrder(deps, ctx, { filingId: filing.id, on: '2026-08-17', deadline: '2026-09-14' }));
    const change = await statuteMeeting(deps, ctx, '2026-09-05', { basedOnId: founding.statuteId });
    unwrap(await addFilingOccasions(deps, ctx, { filingId: filing.id, occasions: [{ id: change.occasionId }] }));

    const done = unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-09-17', registerCourt: 'Amtsgericht Beispielstadt', registerNumber: 'VR 1234' }));
    expect(done).toMatchObject({ state: 'registered', registeredOn: '2026-09-17', registerCourt: 'Amtsgericht Beispielstadt', registerNumber: 'VR 1234' });
    expect(done.interimOrders[0]!.resolvedOn).toBe('2026-09-17');
    expect(unwrap(await getStatute(deps, ctx, { id: change.statuteId }))).toMatchObject({ state: 'valid', registeredOn: '2026-09-17' });
    expect(unwrap(await getStatute(deps, ctx, { id: founding.statuteId }))).toMatchObject({ state: 'superseded', registeredOn: null });
    // Vorverein (G1): am 10.09. gilt schon der beschlossene Stand vom 05.09.
    expect(statuteValidOnInternal(deps.db, '2026-09-10')!.id).toBe(change.statuteId);
    expect([readSetting(deps, 'organization.registerCourt'), readSetting(deps, 'organization.registerNumber'), readSetting(deps, 'organization.registeredOn')]).toEqual(['Amtsgericht Beispielstadt', 'VR 1234', '2026-09-17']);
    expect(auditOf(deps, 'settings.update').map((e) => e.params!.key).filter((k) => String(k).startsWith('organization.'))).toEqual(['organization.registerCourt', 'organization.registerNumber', 'organization.registeredOn']);
    expect(auditOf(deps, 'governance.register.complete').at(-1)!.params).toEqual({ registeredOn: '2026-09-17', occasions: 2, statutes: 1 });
    expect(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-09-18' })).toMatchObject({ ok: false, error: { code: 'filingRegistered' } });
  });

  it('a later registration only updates what is given and differs; the first registration day stays', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const founding = await statuteMeeting(deps, ctx, '2026-07-20', { founding: true });
    const first = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: founding.occasionId }] }));
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: first.id, registeredOn: '2026-08-01', registerCourt: 'Amtsgericht Beispielstadt', registerNumber: 'VR 1234' }));
    const second = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-08-20') }] }));
    const before = auditOf(deps, 'settings.update').length;
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: second.id, registeredOn: '2026-09-10', registerNumber: 'VR 1234' }));
    expect(auditOf(deps, 'settings.update')).toHaveLength(before);
    expect([readSetting(deps, 'organization.registerCourt'), readSetting(deps, 'organization.registeredOn')]).toEqual(['Amtsgericht Beispielstadt', '2026-08-01']);
  });

  it('a statute change is valid from the registration day (Abnahme 7)', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const base = await statuteMeeting(deps, ctx, '2026-01-10', { founding: true });
    unwrap(await registerStatute(deps, ctx, { id: base.statuteId, registeredOn: '2026-01-15' }));
    const change = await statuteMeeting(deps, ctx, '2026-06-10', { basedOnId: base.statuteId });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: change.occasionId }] }));
    expect(filing.state).toBe('due');
    unwrap(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-07-01' }));
    expect(statuteValidOnInternal(deps.db, '2026-06-30')!.id).toBe(base.statuteId);
    expect(statuteValidOnInternal(deps.db, '2026-07-01')!.id).toBe(change.statuteId);
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).state).toBe('registered');
  });

  it('refuses over MCP, without manage, and before the resolution — then nothing is written', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING, { now: NOW });
    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: change.occasionId }] }));
    expect(await completeRegisterFiling(deps, asMcp(ctx), { filingId: filing.id, registeredOn: '2026-07-01' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(await completeRegisterFiling(deps, ctxWith(['governance.read'], userId), { filingId: filing.id, registeredOn: '2026-07-01' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await completeRegisterFiling(deps, ctx, { filingId: filing.id, registeredOn: '2026-06-01', registerCourt: 'Amtsgericht Beispielstadt' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).state).toBe('due');
    expect(readSetting(deps, 'organization.registerCourt')).toBe('');
    expect(auditOf(deps, 'governance.register.complete')).toEqual([]);
  });
});
