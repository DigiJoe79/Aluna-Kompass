import { unwrap } from '@kompass/core';
import { textPdf } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes } from '../src/minutes/signed';
import { decideResolution, saveResolution } from '../src/resolutions';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { previewStatuteRulesChange } from '../src/statute-rules-change';
import { createStatuteDraft, registerStatute, updateStatute } from '../src/statutes';
import { auditOf, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

type Env = ReturnType<typeof setupGovernance>;

/**
 * G-5: Ein eingetragener Stand mit einfacher Mehrheit; eine Versammlung beschließt 3:2 und wird festgeschrieben.
 * Liefert die Regeln mit „mindestens 9/10 der abgegebenen Stimmen“ für einfache Beschlüsse.
 */
async function sealedUnderRegisteredStatute({ deps, ctx }: Env) {
  const statuteId = await withRules(deps, ctx, { assembly: { majorities: { simple: { fraction: 'simple', base: 'cast', abstentions: 'ignored', comparison: 'atLeast' } } } });
  unwrap(await registerStatute(deps, ctx, { id: statuteId, registeredOn: '2026-01-20' }));
  const { meeting, items } = await session(deps, ctx, { items: ['simple'], voters: 5 });
  const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Beschluss', votedAt: '19:20', votes: { yes: 3, no: 2, abstain: 0, invalid: 0 } }));
  unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
  unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
  unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
  unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
  const organs = { [organOf(deps, 'assembly')]: { majorities: { simple: { fraction: { num: 9, den: 10 }, base: 'cast' as const, abstentions: 'ignored' as const, comparison: 'atLeast' as const } } } };
  return { statuteId, resolutionId: r.id, stricter: { organs } };
}

describe('G-5: Regelwerk eines eingetragenen Stands', () => {
  it('previews which sealed resolutions would be judged differently, with number and before → after', async () => {
    const env = setupGovernance(RECORDING);
    const { statuteId, resolutionId, stricter } = await sealedUnderRegisteredStatute(env);
    const preview = unwrap(await previewStatuteRulesChange(env.deps, env.ctx, { id: statuteId, rules: stricter }));
    expect(preview.reasonRequired).toBe(true);
    expect(preview.affected).toHaveLength(1);
    expect(preview.affected[0]).toMatchObject({ resolutionId, number: expect.stringMatching(/^B-2026-/), before: { reached: true, required: { fraction: 'simple' } }, after: { reached: false, required: { fraction: { num: 9, den: 10 } } } });
    expect(await previewStatuteRulesChange(env.deps, { ...env.ctx, permissions: new Set() }, { id: statuteId, rules: stricter })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await previewStatuteRulesChange(env.deps, env.ctx, { id: statuteId })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('refuses a rule change without a reason and audits reason and count with one', async () => {
    const env = setupGovernance(RECORDING);
    const { statuteId, stricter } = await sealedUnderRegisteredStatute(env);
    expect(await updateStatute(env.deps, env.ctx, { id: statuteId, rules: stricter })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'reason', message: 'reasonRequired' }] } });
    unwrap(await updateStatute(env.deps, env.ctx, { id: statuteId, rules: stricter, reason: 'Tippfehler bei der Übernahme korrigiert.' }));
    const [entry] = auditOf(env.deps, 'governance.statute.rulesAmend');
    expect(entry!.params).toEqual({ fields: 'rules', affected: 1 });
    expect(JSON.parse(entry!.after!)).toMatchObject({ reason: 'Tippfehler bei der Übernahme korrigiert.' });
    // Anderes als das Regelwerk (oder unveränderte Regeln) braucht keinen Grund.
    unwrap(await updateStatute(env.deps, env.ctx, { id: statuteId, note: 'Notiz' }));
  });

  it('a draft changes its rules without a reason', async () => {
    const env = setupGovernance(RECORDING);
    const draft = unwrap(await createStatuteDraft(env.deps, env.ctx, { basedOnId: null }));
    const preview = unwrap(await previewStatuteRulesChange(env.deps, env.ctx, { id: draft.id, rules: { organs: {} } }));
    expect(preview).toMatchObject({ reasonRequired: false, affected: [] });
    unwrap(await updateStatute(env.deps, env.ctx, { id: draft.id, rules: { organs: { [organOf(env.deps, 'assembly')]: { noticeDays: 14 } } } }));
    expect(auditOf(env.deps, 'governance.statute.rulesAmend')).toHaveLength(0);
  });
});
