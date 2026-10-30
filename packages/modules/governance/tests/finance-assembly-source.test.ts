import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { financeFiscalYears, getAssemblyResult, saveAssemblyResult } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDischarge } from '../src/discharge';
import { governedAssemblyInternal } from '../src/finance-sources/assembly';
import { fileSignedMinutes, minutesVersionsInternal } from '../src/minutes/signed';
import { decideResolution } from '../src/resolutions';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { adopt, holders, RECORDING, session, setupGovernance, type GovernanceDeps } from './helpers';

type Env = ReturnType<typeof setupGovernance>;
const PERMISSIONS = [...RECORDING, 'finance.read', 'finance.periodClose'];

function fiscalYear(deps: GovernanceDeps) {
  deps.db.insert(financeFiscalYears).values({ id: 'FY25', startsOn: '2025-01-01', endsOn: '2025-12-31', designation: '2025', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
  return deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, 'FY25')).get()!;
}

/** Eine Mitgliederversammlung mit Jahresrechnung und Entlastung (einzeln) am `heldOn`, beendet, Protokoll abgelegt, wenn gewünscht festgeschrieben. */
async function assembly(env: Env, board: string[], opts: { heldOn: string; outcome: 'adopted' | 'rejected' | 'postponed'; accounts?: 'adopted' | 'rejected'; seal?: boolean; mode?: 'individual' | 'collective' }) {
  const { deps, ctx } = env;
  const { meeting, items } = await session(deps, ctx, { items: opts.accounts ? ['accounts', 'discharge'] : ['discharge'], voters: 3, heldOn: opts.heldOn });
  if (opts.accounts) await adopt(deps, ctx, items[0]!.id, { details: { fiscalYearId: 'FY25' }, outcome: opts.accounts });
  const dischargeItem = items.at(-1)!;
  const resolutions = unwrap(await saveDischarge(deps, ctx, { agendaItemId: dischargeItem.id, fiscalYearId: 'FY25', mode: opts.mode ?? 'individual', contactIds: board, votedAt: '19:30', unanimous: true }));
  for (const r of resolutions) unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: opts.outcome, ...(opts.outcome !== 'adopted' ? { outcomeReason: 'Prüfbericht fehlt' } : {}) }));
  unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
  if (opts.seal !== false) {
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
  }
  return meeting;
}

async function setup() {
  const env = setupGovernance(PERMISSIONS);
  const year = fiscalYear(env.deps);
  const board = await holders(env.deps, env.ctx, ['chair', 'treasurer'], '2025-01-01');
  return { env, year, board };
}

describe('governedAssemblyInternal (G7): a sealed assembly delivers discharge and approval to finance', () => {
  it('a sealed assembly with accounts and individual discharge', async () => {
    const { env, year, board } = await setup();
    const meeting = await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    expect(result).toMatchObject({ assemblyOn: '2026-03-14', accountsApproved: 'yes', dischargeMode: 'individual', collectiveOutcome: null, source: { module: 'governance', meetingId: meeting.id, href: `/governance/meetings/${meeting.id}` } });
    expect(result.minutesDocumentId).toBe(minutesVersionsInternal(env.deps.db, meeting.id).at(-1)!.documentId);
    expect(result.source.label).toContain('governance.records.meeting');
    expect(result.discharges.map((d) => [d.contactId, d.outcome, d.decidedOn]).sort()).toEqual(board.map((c) => [c, 'granted', '2026-03-14']).sort());
  });

  it('Review Focus 3: ended but not sealed delivers nothing', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', seal: false });
    expect(governedAssemblyInternal(env.deps, env.deps.db, year)).toBeNull();
  });

  it('Review Focus 2: postponed in the first assembly, granted in the repeat — the later outcome and its day', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'postponed', accounts: 'rejected' });
    const repeat = await assembly(env, board, { heldOn: '2026-06-20', outcome: 'adopted' });
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    expect(result.discharges.map((d) => [d.outcome, d.decidedOn])).toEqual([['granted', '2026-06-20'], ['granted', '2026-06-20']]);
    expect(result).toMatchObject({ assemblyOn: '2026-06-20', accountsApproved: 'no', source: { meetingId: repeat.id } });
  });

  it('a collective discharge carries its outcome; a rejected one is refused', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'rejected', mode: 'collective' });
    expect(governedAssemblyInternal(env.deps, env.deps.db, year)).toMatchObject({ dischargeMode: 'collective', collectiveOutcome: 'refused', discharges: [], accountsApproved: 'notVoted' });
  });

  it('Gremien off: nothing', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted' });
    env.deps.db.transaction((tx) => writeSettingInternal(tx, env.deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(governedAssemblyInternal(env.deps, env.deps.db, year)).toBeNull();
  });

  it('end to end through finance: step 11 shows the managed result, saving by hand is refused', async () => {
    const { env, board } = await setup();
    const meeting = await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    const res = unwrap(await getAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25' }));
    expect(res.result).toMatchObject({ complete: true, managed: { module: 'governance', meetingId: meeting.id } });
    const refused = await saveAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25', assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'assemblyManagedByGovernance' } });
  });

  it('V-8: Gremien switched off after it managed the result — finance knows it was managed, but takes it by hand again', async () => {
    const { env, board } = await setup();
    const res = async () => unwrap(await getAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25' }));
    expect((await res()).formerlyManaged).toBeNull();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    expect((await res()).formerlyManaged).toBeNull();
    env.deps.db.transaction((tx) => writeSettingInternal(tx, env.deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    const off = await res();
    expect(off.result).toBeNull();
    expect(off.formerlyManaged).toEqual({ label: expect.stringContaining('governance.records.meeting') });
  });

  it('W-2: a granted discharge stays granted when a later assembly postpones it', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    await assembly(env, [board[0]!], { heldOn: '2026-06-20', outcome: 'postponed' });
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    expect(result.discharges.map((d) => [d.outcome, d.decidedOn])).toEqual([['granted', '2026-03-14'], ['granted', '2026-03-14']]);
    expect(result.warnings).toEqual([]);
    expect(unwrap(await getAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25' })).result).toMatchObject({ complete: true });
  });

  it('W-2: a later refusal after a granted discharge is a warning, no silent overwrite', async () => {
    const { env, year, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    await assembly(env, [board[0]!], { heldOn: '2026-06-20', outcome: 'rejected' });
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    expect(result.discharges.every((d) => d.outcome === 'granted')).toBe(true);
    expect(result.warnings).toEqual(['dischargeRefusedAfterGranted']);
    const view = unwrap(await getAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25' })).result!;
    expect(view).toMatchObject({ complete: true });
    expect(view.warnings).toContain('dischargeRefusedAfterGranted');
  });

  it('W-2: recording a discharge for someone already discharged for the year warns', async () => {
    const { env, board } = await setup();
    await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted' });
    const { meeting, items } = await session(env.deps, env.ctx, { items: ['discharge'], voters: 3, heldOn: '2026-10-29' });
    const [again] = unwrap(await saveDischarge(env.deps, env.ctx, { agendaItemId: items[0]!.id, fiscalYearId: 'FY25', mode: 'individual', contactIds: [board[0]!], votedAt: '19:30', unanimous: true }));
    expect(again!.warnings).toContain('alreadyDischarged');
    expect(meeting.id).toBeTruthy();
  });

  it('W-15: step 11 names the minutes of every meeting whose decision counts', async () => {
    const { env, year, board } = await setup();
    const first = await assembly(env, [board[0]!], { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    const repeat = await assembly(env, [board[1]!], { heldOn: '2026-06-20', outcome: 'adopted' });
    const minutesOf = (id: string) => minutesVersionsInternal(env.deps.db, id).at(-1)!.documentId;
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    expect(result.minutesDocumentId).toBe(minutesOf(repeat.id));
    expect(result.minutesDocumentIds).toEqual([minutesOf(first.id), minutesOf(repeat.id)]);
    expect(unwrap(await getAssemblyResult(env.deps, env.ctx, { fiscalYearId: 'FY25' })).result!.minutesDocumentIds).toEqual([minutesOf(first.id), minutesOf(repeat.id)]);
  });

  it('K-2: a later assembly whose decision does not count does not head step 11', async () => {
    const { env, year, board } = await setup();
    const first = await assembly(env, board, { heldOn: '2026-03-14', outcome: 'adopted', accounts: 'adopted' });
    await assembly(env, [board[0]!], { heldOn: '2026-06-20', outcome: 'postponed' });
    const result = governedAssemblyInternal(env.deps, env.deps.db, year)!;
    const minutes = minutesVersionsInternal(env.deps.db, first.id).at(-1)!.documentId;
    expect(result.source.meetingId).toBe(first.id);
    expect(result.source.href).toBe(`/governance/meetings/${first.id}`);
    expect(result.assemblyOn).toBe('2026-03-14');
    expect(result.minutesDocumentId).toBe(minutes);
    expect(result.minutesDocumentIds).toEqual([minutes]);
  });
});
