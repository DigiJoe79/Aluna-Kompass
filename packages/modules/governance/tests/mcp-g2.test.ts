import { unwrap, writeSettingInternal } from '@kompass/core';
import { fakeMailTransport, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { GOVERNANCE_MCP_TOOLS } from '../src/mcp-tools';
import { governanceOrgans } from '../src/schema';
import { addressedPerson, asMcp, GOVERNANCE_PERMISSIONS, member, setupGovernance } from './helpers';

const tool = (name: string) => GOVERNANCE_MCP_TOOLS.find((t) => t.name === name)!;
const G2 = [
  'governance_meetings_list',
  'governance_meeting_get',
  'governance_meeting_create',
  'governance_meeting_update',
  'governance_meeting_delete',
  'governance_meeting_cancel',
  'governance_agenda_item_save',
  'governance_agenda_item_remove',
  'governance_agenda_reorder',
  'governance_agenda_propose',
  'governance_motion_save',
  'governance_assembly_request_save',
  'governance_assembly_requests_list',
  'governance_invitation_run_preview',
  'governance_invitation_run_start',
  'governance_invitation_run_continue',
  'governance_invitation_run_get',
  'governance_invitation_dispatch_state',
  'governance_invitation_mail',
  'governance_invitation_mark_post',
  'governance_invitation_move',
  'governance_board_invitation_issue',
  'governance_board_invitation_send',
  'governance_invitation_note',
  'governance_deadlines',
];
const HUMAN_ONLY = ['governance_invitation_run_start', 'governance_invitation_run_continue', 'governance_invitation_mail', 'governance_board_invitation_issue', 'governance_board_invitation_send'];
type Id = { id: string };

describe('governance tools of G2', () => {
  it('brings the planned tools, each naming its permission, human only where it issues or sends', () => {
    const names = GOVERNANCE_MCP_TOOLS.map((t) => t.name);
    for (const name of G2) expect(names, name).toContain(name);
    for (const name of G2) expect(tool(name).description, name).toMatch(/governance\.(read|manage)/);
    for (const name of HUMAN_ONLY) expect(tool(name).description, name).toContain('Human only');
  });

  it('every tool calls its service; the human-only ones refuse over MCP', async () => {
    const mail = fakeMailTransport();
    const { deps, ctx } = setupGovernance([...GOVERNANCE_PERMISSIONS, 'dms.view', 'dms.send'], { now: '2026-08-10T08:00:00.000Z', mail });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
    await member(deps, { contactId: await addressedPerson(deps, { email: 'a@example.org' }) });
    const mcp = asMcp(ctx);
    const organs = deps.db.select().from(governanceOrgans).all();
    const mv = organs.find((o) => o.kind === 'assembly')!.id;
    const board = organs.find((o) => o.kind === 'board')!.id;
    const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' };
    const meeting = unwrap(await tool('governance_meeting_create').handler(deps, mcp, { organId: mv, kind: 'ordinary', ...head })) as Id;
    expect(await tool('governance_meeting_update').handler(deps, mcp, { id: meeting.id, place: 'Saal' })).toMatchObject({ ok: true });
    expect(await tool('governance_meetings_list').handler(deps, mcp, {})).toMatchObject({ ok: true });
    const items = unwrap(await tool('governance_agenda_propose').handler(deps, mcp, { meetingId: meeting.id })) as Id[];
    const added = unwrap(await tool('governance_agenda_item_save').handler(deps, mcp, { meetingId: meeting.id, kind: 'simple', title: 'Neu' })) as Id;
    expect(await tool('governance_agenda_reorder').handler(deps, mcp, { meetingId: meeting.id, itemIds: [added.id, ...items.map((i) => i.id)] })).toMatchObject({ ok: true });
    expect(await tool('governance_agenda_item_remove').handler(deps, mcp, { id: added.id })).toMatchObject({ ok: true });
    expect(await tool('governance_motion_save').handler(deps, mcp, { meetingId: meeting.id, receivedOn: '2026-08-01', text: 'Antrag' })).toMatchObject({ ok: true });
    expect(await tool('governance_meeting_get').handler(deps, mcp, { id: meeting.id })).toMatchObject({ ok: true, value: { motions: [{ late: false }] } });
    expect(await tool('governance_assembly_request_save').handler(deps, mcp, { organId: mv, receivedOn: '2026-08-01', supporters: 1, purpose: 'x' })).toMatchObject({ ok: true });
    expect(await tool('governance_assembly_requests_list').handler(deps, mcp, {})).toMatchObject({ ok: true });
    expect(await tool('governance_invitation_run_preview').handler(deps, mcp, { meetingId: meeting.id, kind: 'invitation' })).toMatchObject({ ok: true });
    expect(await tool('governance_deadlines').handler(deps, mcp, {})).toMatchObject({ ok: true });
    for (const name of HUMAN_ONLY) expect(await tool(name).handler(deps, mcp, { meetingId: meeting.id, kind: 'invitation', runId: 'r' }), name).toMatchObject({ ok: false, error: { type: 'conflict', code: 'humanOnly' } });
    // Am Bildschirm ausgestellt, liest und vermerkt ein Agent den Versand.
    const run = unwrap(await tool('governance_invitation_run_start').handler(deps, ctx, { meetingId: meeting.id, kind: 'invitation' })) as Id;
    unwrap(await tool('governance_invitation_run_continue').handler(deps, ctx, { runId: run.id }));
    expect(await tool('governance_invitation_run_get').handler(deps, mcp, { runId: run.id })).toMatchObject({ ok: true, value: { status: 'done', issued: 1 } });
    const state = unwrap(await tool('governance_invitation_dispatch_state').handler(deps, mcp, { runId: run.id })) as { mail: { documentId: string }[] };
    expect(await tool('governance_invitation_move').handler(deps, mcp, { runId: run.id, documentIds: [state.mail[0]!.documentId], to: 'post' })).toMatchObject({ ok: true });
    expect(await tool('governance_invitation_mark_post').handler(deps, mcp, { runId: run.id, sentAt: '2026-08-10' })).toMatchObject({ ok: true, value: { count: 1 } });
    expect(await tool('governance_invitation_mail').handler(deps, ctx, { runId: run.id })).toMatchObject({ ok: true });
    const boardMeeting = unwrap(await tool('governance_meeting_create').handler(deps, mcp, { organId: board, kind: 'board', ...head })) as Id;
    expect(await tool('governance_invitation_note').handler(deps, mcp, { meetingId: boardMeeting.id, invitedOn: '2026-08-09', note: 'Messenger' })).toMatchObject({ ok: true });
    const second = unwrap(await tool('governance_meeting_create').handler(deps, mcp, { organId: board, kind: 'board', ...head })) as Id;
    expect(await tool('governance_board_invitation_issue').handler(deps, ctx, { meetingId: second.id })).toMatchObject({ ok: true });
    expect(await tool('governance_board_invitation_send').handler(deps, ctx, { meetingId: second.id })).toMatchObject({ ok: true });
    const third = unwrap(await tool('governance_meeting_create').handler(deps, mcp, { organId: board, kind: 'board', ...head })) as Id;
    expect(await tool('governance_meeting_cancel').handler(deps, mcp, { id: third.id, cancelledOn: '2026-08-10', reason: 'x' })).toMatchObject({ ok: true });
    const fourth = unwrap(await tool('governance_meeting_create').handler(deps, mcp, { organId: board, kind: 'board', ...head })) as Id;
    expect(await tool('governance_meeting_delete').handler(deps, mcp, { id: fourth.id })).toMatchObject({ ok: true });
  });
});
