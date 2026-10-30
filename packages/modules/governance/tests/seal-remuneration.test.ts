import { readSetting, unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { boardRemunerationResolutionInternal, setBoardRemuneration } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes, minutesVersionsInternal } from '../src/minutes/signed';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { adopt, officeOf, organOf, RECORDING, session, setupGovernance } from './helpers';

const PERMISSIONS = [...RECORDING, 'finance.setup'];

async function sealedRemuneration(outcome: 'adopted' | 'rejected' = 'adopted') {
  const env = setupGovernance(PERMISSIONS);
  const { deps, ctx } = env;
  const { meeting, items } = await session(deps, ctx, { items: ['remuneration'], voters: 3 });
  const details = { statuteReference: '§ 12 Abs. 2 der Satzung', decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeOf(deps, 'chair')], mode: 'flat', amountCents: 84000, validFrom: '2026-10-01' };
  const resolution = await adopt(deps, ctx, items[0]!.id, { details, outcome, text: 'Die Versammlung beschließt eine Ehrenamtspauschale für den Vorsitz.' });
  unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
  unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
  unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
  return { ...env, meeting, resolution };
}
const board = (deps: ReturnType<typeof setupGovernance>['deps']) =>
  Object.fromEntries(['Allowed', 'BasisText', 'DocumentId', 'ValidFrom', 'DecidedOn', 'ResolutionId'].map((k) => [k, readSetting(deps, `finance.boardRemuneration${k}`)]));

describe('sealing a remuneration resolution (G7)', () => {
  it('an adopted remuneration writes the six settings of finance', async () => {
    const { deps, meeting, resolution } = await sealedRemuneration();
    expect(board(deps)).toEqual({ Allowed: true, BasisText: '§ 12 Abs. 2 der Satzung', DocumentId: minutesVersionsInternal(deps.db, meeting.id).at(-1)!.documentId, ValidFrom: '2026-10-01', DecidedOn: '2026-09-05', ResolutionId: resolution.id });
  });

  it('then the remuneration can no longer be set by hand; with Gremien off it can', async () => {
    const { deps, ctx } = await sealedRemuneration();
    const refused = await setBoardRemuneration(deps, ctx, { allowed: false, basisText: '' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'boardRemunerationManagedByGovernance' } });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect((await setBoardRemuneration(deps, ctx, { allowed: false, basisText: '' })).ok).toBe(true);
  });

  it('finance names the resolution with its number and a link to it', async () => {
    const { deps, ctx, resolution } = await sealedRemuneration();
    expect(boardRemunerationResolutionInternal(deps, ctx)).toMatchObject({ resolutionId: resolution.id, label: expect.stringContaining('B-2026-001'), href: `/governance/resolutions/${resolution.id}` });
  });

  it('a rejected remuneration writes nothing', async () => {
    const { deps } = await sealedRemuneration('rejected');
    expect(board(deps)).toMatchObject({ Allowed: false, ResolutionId: '' });
  });
});
