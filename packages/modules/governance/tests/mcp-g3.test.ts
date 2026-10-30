import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { financeFiscalYears } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { governanceModule } from '../src/manifest';
import { GOVERNANCE_MCP_TOOLS } from '../src/mcp-tools';
import { governanceRecordLabels } from '../src/record-labels';
import { asMcp, holders, member, officeOf, organOf, RECORDING, setupGovernance } from './helpers';

const tool = (name: string) => GOVERNANCE_MCP_TOOLS.find((t) => t.name === name)!;
const G3 = [
  'governance_meeting_start',
  'governance_meeting_take_over',
  'governance_meeting_end',
  'governance_meeting_reopen',
  'governance_attendance_prefill',
  'governance_attendance_save',
  'governance_attendance_arrive',
  'governance_attendance_leave',
  'governance_findings_save',
  'governance_quorum',
  'governance_resolution_save',
  'governance_resolution_decide',
  'governance_resolution_get',
  'governance_resolutions_list',
  'governance_discharge_candidates',
  'governance_discharge_save',
  'governance_election_round_save',
  'governance_election_accept',
  'governance_meeting_item_add',
  'governance_late_motion_admit',
  'governance_circular_create',
  'governance_circular_response_save',
  'governance_circular_decide',
  'governance_circular_get',
  'governance_circulars_list',
  'governance_meeting_context',
  'governance_floor_motion_record',
];
type Id = { id: string };
const call = async (name: string, ctx: Parameters<ReturnType<typeof tool>['handler']>[1], deps: Parameters<ReturnType<typeof tool>['handler']>[0], args: unknown) => unwrap(await tool(name).handler(deps, ctx, args));

describe('governance tools of G3', () => {
  it('brings the planned tools, each naming its permission; governance.record is named', () => {
    const names = GOVERNANCE_MCP_TOOLS.map((t) => t.name);
    for (const name of G3) expect(names, name).toContain(name);
    for (const name of G3) expect(tool(name).description, name).toMatch(/governance\.(read|manage|record)/);
    expect(G3.filter((name) => tool(name).description.includes('governance.record')).length).toBeGreaterThan(10);
  });

  it('every tool calls its service', async () => {
    const { deps, ctx } = setupGovernance([...RECORDING]);
    const mcp = asMcp(ctx);
    deps.db.insert(financeFiscalYears).values({ id: 'FY25', startsOn: '2025-01-01', endsOn: '2025-12-31', designation: '2025', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
    const [chair] = await holders(deps, ctx, ['chair'], '2025-01-01');
    await member(deps, { contactId: chair });
    const other = await member(deps);
    const meeting = (await call('governance_meeting_create', mcp, deps, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' })) as Id;
    const [simple, discharge, election] = await Promise.all(['simple', 'discharge', 'election'].map(async (kind) => (await call('governance_agenda_item_save', mcp, deps, { meetingId: meeting.id, kind, title: kind })) as Id));
    const motion = (await call('governance_motion_save', mcp, deps, { meetingId: meeting.id, receivedOn: '2026-09-04', text: 'Antrag' })) as Id;
    await call('governance_meeting_start', mcp, deps, { meetingId: meeting.id });
    const rows = (await call('governance_attendance_prefill', mcp, deps, { meetingId: meeting.id })) as Id[];
    for (const row of rows) await call('governance_attendance_arrive', mcp, deps, { attendanceId: row.id, at: '19:00' });
    const guest = (await call('governance_attendance_save', mcp, deps, { meetingId: meeting.id, role: 'guest', guestLabel: 'Gast' })) as Id;
    await call('governance_attendance_arrive', mcp, deps, { attendanceId: guest.id, at: '19:05' });
    await call('governance_attendance_leave', mcp, deps, { attendanceId: guest.id, at: '19:10' });
    expect(await call('governance_quorum', mcp, deps, { meetingId: meeting.id, at: '19:30' })).toMatchObject({ present: 2 });
    expect(await call('governance_meeting_context', mcp, deps, { meetingId: meeting.id })).toMatchObject({ organ: { kind: 'assembly' }, writer: { isCaller: true } });
    expect(await call('governance_findings_save', mcp, deps, { meetingId: meeting.id, findings: { agendaApproved: true } })).toMatchObject({ agendaApproved: true });
    const resolution = (await call('governance_resolution_save', mcp, deps, { agendaItemId: simple!.id, text: 'x', votedAt: '19:30', unanimous: true })) as Id;
    await call('governance_resolution_decide', mcp, deps, { id: resolution.id, outcome: 'adopted' });
    expect(await call('governance_resolution_get', mcp, deps, { id: resolution.id })).toMatchObject({ outcome: 'adopted' });
    expect(await call('governance_discharge_candidates', mcp, deps, { fiscalYearId: 'FY25' })).toHaveLength(1);
    expect(await call('governance_discharge_save', mcp, deps, { agendaItemId: discharge!.id, fiscalYearId: 'FY25', mode: 'collective', votedAt: '19:40', unanimous: true })).toHaveLength(1);
    const elected = (await call('governance_election_round_save', mcp, deps, { agendaItemId: election!.id, officeId: officeOf(deps, 'auditor'), votedAt: '19:50', round: { number: 1, runoff: false, candidates: [], no: 0, abstain: 0, invalid: 0, unanimousContactId: other.contactId } })) as Id;
    await call('governance_election_accept', mcp, deps, { resolutionId: elected.id, contactId: other.contactId });
    await call('governance_meeting_item_add', mcp, deps, { meetingId: meeting.id, kind: 'other', title: 'Verschiedenes' });
    expect(await call('governance_late_motion_admit', mcp, deps, { motionId: motion.id, votedAt: '20:00', unanimous: true, kind: 'simple' })).toMatchObject({ item: null });
    expect(await call('governance_resolutions_list', mcp, deps, { year: 2026 })).toHaveLength(4);
    expect(await call('governance_floor_motion_record', mcp, deps, { meetingId: meeting.id, text: 'Antrag aus der Versammlung', kind: 'simple' })).toMatchObject({ agendaItemId: null });
    await call('governance_meeting_take_over', mcp, deps, { meetingId: meeting.id });
    await call('governance_meeting_end', mcp, deps, { meetingId: meeting.id, endedAt: '21:00' });
    expect(await call('governance_meeting_reopen', mcp, deps, { meetingId: meeting.id })).toMatchObject({ state: 'running' });
    const detail = (await call('governance_meeting_get', mcp, deps, { id: meeting.id })) as { attendance: unknown[]; resolutions: unknown[]; findings: { agendaApproved: boolean } };
    expect(detail).toMatchObject({ attendance: { length: 3 }, resolutions: { length: 5 }, findings: { agendaApproved: true } });

    await holders(deps, ctx, ['board', 'treasurer'], '2025-01-01');
    const circular = (await call('governance_circular_create', mcp, deps, { organId: organOf(deps, 'board'), kind: 'simple', text: 'x', requestedOn: '2026-09-10', deadline: '2026-09-17', channel: 'email' })) as { id: string; responses: Id[] };
    for (const r of circular.responses) await call('governance_circular_response_save', mcp, deps, { id: r.id, answer: 'yes', answeredOn: '2026-09-11' });
    expect(await call('governance_circular_decide', mcp, deps, { id: circular.id, outcome: 'adopted', decidedOn: '2026-09-18', decidedByContactId: chair })).toMatchObject({ evaluation: { reached: true } });
    expect(await call('governance_circular_get', mcp, deps, { id: circular.id })).toMatchObject({ outcome: 'adopted' });
    expect(await call('governance_circulars_list', mcp, deps, {})).toHaveLength(1);

    expect(governanceRecordLabels(deps, ctx, 'governanceResolution', resolution.id)).toMatchObject({ label: { key: 'governance.records.resolutionOn', params: { date: '2026-09-05' } }, state: 'ok' });
    expect(governanceRecordLabels(deps, ctx, 'governanceCircular', circular.id)).toMatchObject({ label: { key: 'governance.records.circular', params: { date: '2026-09-10' } }, state: 'ok' });
    expect(governanceRecordLabels(deps, ctxWith([], ctx.userId!), 'governanceResolution', resolution.id)).toMatchObject({ state: 'forbidden' });
    expect(governanceModule.linkedDocumentAccess?.map((a) => a.entityType)).toEqual(['governanceMeeting', 'governanceCircular', 'governanceResolution', 'governanceRegisterFiling']);
  });
});
