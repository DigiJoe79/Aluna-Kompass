import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { GOVERNANCE_MCP_TOOLS } from '../src/mcp-tools';
import { governanceRecordReferences } from '../src/record-references';
import { endMeeting } from '../src/session';
import { asMcp, RECORDING, session, setupGovernance } from './helpers';

const tool = (name: string) => GOVERNANCE_MCP_TOOLS.find((t) => t.name === name)!;
const G4 = [
  'governance_minutes_text',
  'governance_attendance_list_issue',
  'governance_register_data_issue',
  'governance_minutes_file_signed',
  'governance_minutes_attach',
  'governance_minutes_replace',
  'governance_seal_preview',
  'governance_meeting_seal',
  'governance_circular_seal',
  'governance_minutes_correct',
  'governance_meeting_backfill',
  'governance_meeting_backfill_correct',
  'governance_member_proposals',
];
const pdfBase64 = () => Buffer.from('%PDF-1.4\n%Kompass\n').toString('base64');

describe('MCP tools of G4', () => {
  it('every tool of the plan exists and calls its service', () => {
    for (const name of G4) expect(tool(name)?.service, name).toBeTypeOf('function');
  });

  it('files the signed minutes from contentBase64, reads text and preview; the three human-only tools refuse over MCP', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting } = await session(deps, ctx, { items: [], voters: 2 });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const mcp = asMcp(ctx);
    expect(await tool('governance_minutes_file_signed').handler(deps, mcp, { meetingId: meeting.id, contentBase64: '***' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const filed = unwrap(await tool('governance_minutes_file_signed').handler(deps, mcp, { meetingId: meeting.id, contentBase64: pdfBase64() })) as { documentId: string; version: number };
    expect(filed.version).toBe(1);
    expect(governanceRecordReferences(deps, 'document', filed.documentId)).toEqual([expect.objectContaining({ entity: 'governanceMeeting', id: meeting.id })]);
    expect(unwrap(await tool('governance_minutes_text').handler(deps, mcp, { meetingId: meeting.id }))).toMatchObject({ head: expect.any(Array) });
    expect(unwrap(await tool('governance_seal_preview').handler(deps, mcp, { meetingId: meeting.id }))).toMatchObject({ blockers: [] });
    for (const [name, args] of [
      ['governance_meeting_seal', { meetingId: meeting.id }],
      ['governance_circular_seal', { circularId: 'x' }],
      ['governance_minutes_correct', { meetingId: meeting.id, contentBase64: pdfBase64(), reason: 'Fehler' }],
      ['governance_minutes_replace', { meetingId: meeting.id, reason: 'Falsche Datei' }],
    ] as const) expect(await tool(name).handler(deps, mcp, args), name).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
  });
});
