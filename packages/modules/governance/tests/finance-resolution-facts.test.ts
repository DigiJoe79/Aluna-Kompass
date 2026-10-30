import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { resolutionFactsOf } from '@kompass/module-finance';
import { memberTypes, saveFeeSchedule } from '@kompass/module-members';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes } from '../src/minutes/signed';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { adopt, RECORDING, session, setupGovernance } from './helpers';

const membersCtx: CallContext = { ...systemContext(), permissions: new Set(['members.fees', 'members.read']) };

describe('resolution facts for finance and members (V-3)', () => {
  it('kind, sealed and outcome of a resolution; a fee schedule takes it only once sealed; Gremien off → null', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['feeSchedule'], voters: 3 });
    const resolution = await adopt(deps, ctx, items[0]!.id, { details: { feeScheduleId: null } });
    expect(resolutionFactsOf(deps, deps.db, resolution.id)).toEqual({ kind: 'feeSchedule', final: false, outcome: 'adopted', decidedOn: '2026-09-05' });
    const typeId = deps.db.select().from(memberTypes).all().find((t) => t.key === 'regular')!.id;
    const save = () => saveFeeSchedule(deps, membersCtx, { validFrom: '2027-01-01', resolvedOn: '2026-09-05', resolutionId: resolution.id, rules: [{ typeId, amountCents: 3000, interval: 'yearly' }] });
    expect(await save()).toMatchObject({ ok: false, error: { issues: [{ message: 'resolutionNotFinal' }] } });

    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(resolutionFactsOf(deps, deps.db, resolution.id)).toMatchObject({ final: true });
    expect(unwrap(await save())).toMatchObject({ resolutionId: resolution.id, warnings: [] });

    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(resolutionFactsOf(deps, deps.db, resolution.id)).toBeNull();
  });

  it('W-13: the resolution context names the fee schedule that uses it', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['feeSchedule'], voters: 3 });
    const resolution = await adopt(deps, ctx, items[0]!.id, { details: { feeScheduleId: null } });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const typeId = deps.db.select().from(memberTypes).all().find((t) => t.key === 'regular')!.id;
    const schedule = unwrap(await saveFeeSchedule(deps, membersCtx, { validFrom: '2027-01-01', resolvedOn: '2026-09-05', resolutionId: resolution.id, rules: [{ typeId, amountCents: 3000, interval: 'yearly' }] }));
    const { getResolutionContext } = await import('../src/resolution-rows');
    expect(unwrap(await getResolutionContext(deps, ctx, { id: resolution.id })).usedBy).toEqual([{ kind: 'feeSchedule', id: schedule.id, label: '2027-01-01' }]);
  });
});

