import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_MINUTES_PRINT_TEMPLATE_KEY, MINUTES_PRINT_TEMPLATE_KEY } from '../src/minutes/template';
import { getMinutesText, printMinutesDraft } from '../src/minutes/print';
import { endMeeting } from '../src/session';
import { RECORDING, session, setupGovernance } from './helpers';

describe('printMinutesDraft', () => {
  it('prints from recorded on, without filing; before that meetingNotRecorded', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: ['simple'], voters: 2 });
    expect(await printMinutesDraft(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { code: 'meetingNotRecorded' } });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '20:00' }));
    const get = vi.spyOn(deps.registry.documentTemplates, 'get');
    const before = deps.db.select().from(documents).all().length;
    const printed = unwrap(await printMinutesDraft(deps, ctx, { meetingId: meeting.id }));
    expect(new TextDecoder().decode(printed.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(printed.filename).toMatch(/\.pdf$/);
    expect(get).toHaveBeenCalledWith(MINUTES_PRINT_TEMPLATE_KEY);
    expect(deps.db.select().from(documents).all()).toHaveLength(before);
    expect(await printMinutesDraft(deps, ctxWith(['governance.read'], userId), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await printMinutesDraft(deps, ctx, { meetingId: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await getMinutesText(deps, ctxWith(['governance.read'], userId), { meetingId: meeting.id }))).toMatchObject({ defectList: [{ kind: 'notInvited' }], items: [{ heading: expect.any(String) }] });
  });

  it('a board meeting takes the board template', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { kind: 'board', items: [] });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '20:00' }));
    const get = vi.spyOn(deps.registry.documentTemplates, 'get');
    unwrap(await printMinutesDraft(deps, ctx, { meetingId: meeting.id }));
    expect(get).toHaveBeenCalledWith(BOARD_MINUTES_PRINT_TEMPLATE_KEY);
  });
});

describe('footer of the draft (U2)', () => {
  it('names the day of the draft in the footer and renders', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: ['simple'], voters: 2 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '20:00' }));
    const render = vi.spyOn(deps.documents, 'render');
    const printed = unwrap(await printMinutesDraft(deps, ctx, { meetingId: meeting.id }));
    expect(new TextDecoder().decode(printed.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(render.mock.calls[0]![0].slots.footerNote).toContain('05.09.2026');
  }, 60_000);
});
