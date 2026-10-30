import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { getDocument, readLinkedDocument, textPdf } from '@kompass/module-dms';
import { financeFiscalYears, readAuditResolutionMinutes } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCircular, decideCircular, saveCircularResponse } from '../src/circulars';
import { saveDischarge } from '../src/discharge';
import { auditResolutionsInternal } from '../src/finance-sources/audit-resolutions';
import { fileSignedMinutes, minutesVersionsInternal } from '../src/minutes/signed';
import { decideResolution } from '../src/resolutions';
import { sealCircular, sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { adopt, holders, officeOf, organOf, RECORDING, session, setupGovernance, type GovernanceDeps } from './helpers';

const PERMISSIONS = [...RECORDING, 'finance.read', 'finance.setup'];
type Env = ReturnType<typeof setupGovernance>;
type Item = { kind: Parameters<typeof session>[2]['items'][number]; details?: unknown; outcome?: 'adopted' | 'rejected' };

function fiscalYears(deps: GovernanceDeps) {
  for (const y of ['2024', '2025']) deps.db.insert(financeFiscalYears).values({ id: `FY${y.slice(2)}`, startsOn: `${y}-01-01`, endsOn: `${y}-12-31`, designation: y, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
  return deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, 'FY25')).get()!;
}

/** Eine Sitzung mit den Beschlüssen `items`, beendet, Protokoll abgelegt und — wenn nicht anders gesagt — festgeschrieben. */
async function meetingWith(env: Env, heldOn: string, items: Item[], opts: { kind?: 'board'; seal?: boolean } = {}) {
  const { deps, ctx } = env;
  const s = await session(deps, ctx, { items: items.map((i) => i.kind), voters: 3, heldOn, ...(opts.kind ? { kind: opts.kind } : {}) });
  const ids: string[] = [];
  for (const [n, item] of items.entries()) ids.push((await adopt(deps, ctx, s.items[n]!.id, { details: item.details, outcome: item.outcome ?? 'adopted', votedAt: `19:${10 + n}` })).id);
  unwrap(await endMeeting(deps, ctx, { meetingId: s.meeting.id, endedAt: '21:00' }));
  if (opts.seal !== false) {
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: s.meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: s.meeting.id }));
  }
  return { meeting: s.meeting, ids };
}

/** Ein Umlauf des Vorstands, angenommen am `decidedOn` und festgeschrieben. */
async function circularWith(env: Env, chair: string, decidedOn: string, kind: 'remuneration' | 'reserve', details: unknown) {
  const { deps, ctx } = env;
  const requestedOn = `${decidedOn.slice(0, 7)}-01`;
  const circular = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), kind, text: 'Umlauftext', requestedOn, deadline: decidedOn, channel: 'email', details }));
  for (const r of circular.responses) unwrap(await saveCircularResponse(deps, ctx, { id: r.id, answer: 'yes', answeredOn: requestedOn }));
  unwrap(await decideCircular(deps, ctx, { id: circular.id, outcome: 'adopted', decidedOn, decidedByContactId: chair }));
  unwrap(await sealCircular(deps, ctx, { circularId: circular.id }));
  return circular;
}

const remuneration = (deps: GovernanceDeps, validFrom: string, amountCents = 84000) => ({ kind: 'remuneration' as const, details: { statuteReference: '§ 9', decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeOf(deps, 'chair')], mode: 'flat', amountCents, validFrom } });

describe('auditResolutionsInternal (G-30): the finance-relevant sealed resolutions of the audit year', () => {
  it('decided in the year or effective in it — fiscal year, or “valid from” until the next rule of the same kind; no free text', async () => {
    const env = setupGovernance(PERMISSIONS);
    const { deps, ctx } = env;
    const year = fiscalYears(deps);
    const [chair, treasurer] = await holders(deps, ctx, ['chair', 'treasurer'], '2022-01-01');
    // Vor 2025 im Umlauf des Vorstands (die Mitglieder der Versammlungen kommen erst 2025 dazu):
    // 2023 Vergütung ab 2023 — ersetzt ab 2024-07-01, wirkt 2025 also nicht mehr; 2024 Vergütung ab 2024-07-01, wirkt
    // 2025 bis zur nächsten am 2025-07-01.
    await circularWith(env, chair!, '2023-03-10', 'remuneration', remuneration(deps, '2023-01-01', 50000).details);
    await circularWith(env, chair!, '2024-11-20', 'remuneration', remuneration(deps, '2024-07-01', 60000).details);
    // 2025: Vergütung ab 2025-07-01, Regel für Aufwendungsersatz, Rücklage für 2025 (abgelehnt), ein einfacher Beschluss.
    const y25 = await meetingWith(env, '2025-03-14', [
      remuneration(deps, '2025-07-01'),
      { kind: 'expenseRule', details: { basis: 'boardResolution', rule: 'Fahrtkosten nach Beleg', validFrom: '2025-04-01' } },
      { kind: 'reserve', details: { type: 'nr1', purpose: 'Neues Gehege', amountCents: 500000, fiscalYearId: 'FY25', action: 'create' }, outcome: 'rejected' },
      { kind: 'simple' },
    ]);
    // Eine Versammlung, beendet, aber nicht festgeschrieben: nichts.
    await meetingWith(env, '2025-06-01', [{ kind: 'reserve', details: { type: 'nr3', purpose: null, amountCents: 1000, fiscalYearId: 'FY25', action: 'create' } }], { seal: false });
    // 2026: Kassenbericht 2025 und Entlastung einzeln — je Person ein Beschluss, einer verweigert.
    const y26s = await session(deps, ctx, { items: ['accounts', 'discharge'], voters: 3, heldOn: '2026-03-20' });
    await adopt(deps, ctx, y26s.items[0]!.id, { details: { fiscalYearId: 'FY25' } });
    const discharges = unwrap(await saveDischarge(deps, ctx, { agendaItemId: y26s.items[1]!.id, fiscalYearId: 'FY25', mode: 'individual', contactIds: [chair!, treasurer!], votedAt: '19:30', unanimous: true }));
    unwrap(await decideResolution(deps, ctx, { id: discharges[0]!.id, outcome: 'adopted' }));
    unwrap(await decideResolution(deps, ctx, { id: discharges[1]!.id, outcome: 'rejected', outcomeReason: 'Belege fehlen' }));
    unwrap(await endMeeting(deps, ctx, { meetingId: y26s.meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: y26s.meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: y26s.meeting.id }));
    // Ein Umlauf des Vorstands: Entnahme aus der Rücklage für 2025, ohne Protokoll.
    await circularWith(env, chair!, '2025-08-03', 'reserve', { type: 'nr3', purpose: null, amountCents: 20000, fiscalYearId: 'FY25', action: 'withdraw' });

    const rows = auditResolutionsInternal(deps, deps.db, year)!;
    const minutes = (meetingId: string) => minutesVersionsInternal(deps.db, meetingId).at(-1)!.documentId;
    expect(rows.map((r) => [r.decidedOn, r.kind, r.outcome, r.viaCircular])).toEqual([
      ['2024-11-20', 'remuneration', 'adopted', true],
      ['2025-03-14', 'remuneration', 'adopted', false],
      ['2025-03-14', 'expenseRule', 'adopted', false],
      ['2025-03-14', 'reserve', 'rejected', false],
      ['2025-08-03', 'reserve', 'adopted', true],
      ['2026-03-20', 'accounts', 'adopted', false],
      ['2026-03-20', 'discharge', 'adopted', false],
      ['2026-03-20', 'discharge', 'rejected', false],
    ]);
    expect(rows[0]).toMatchObject({ number: expect.stringMatching(/^B-2024-/), organ: 'Vorstand', minutesDocumentId: null, facts: { amountCents: 60000, validFrom: '2024-07-01', remunerationMode: 'flat', organs: 'Vorstand' } });
    expect(rows[1]).toMatchObject({ id: y25.ids[0], organ: 'Mitgliederversammlung', minutesDocumentId: minutes(y25.meeting.id) });
    expect(rows[2]).toMatchObject({ id: y25.ids[1], facts: { expenseBasis: 'boardResolution', validFrom: '2025-04-01' } });
    expect(rows[3]!.facts).toEqual({ amountCents: 500000, reserveType: 'nr1', reserveAction: 'create', fiscalYear: '2025' });
    expect(rows[4]).toMatchObject({ organ: 'Vorstand', facts: { reserveAction: 'withdraw', reserveType: 'nr3' } });
    expect(rows[5]!.facts).toEqual({ fiscalYear: '2025' });
    expect(rows[6]!.facts).toMatchObject({ fiscalYear: '2025', persons: expect.stringContaining('(') });
    // Kein Freitext: weder Antragstext noch Regel noch Zweck.
    expect(JSON.stringify(rows)).not.toMatch(/Fahrtkosten|Gehege|Beschlusstext|Belege fehlen/);
  });

  it('G-30 Option B: the auditor (finance.audit, without governance.read) opens the minutes of a listed resolution — no other Gremien document', async () => {
    const env = setupGovernance(PERMISSIONS);
    const { deps } = env;
    fiscalYears(deps);
    const assembly = await meetingWith(env, '2025-03-14', [{ kind: 'accounts', details: { fiscalYearId: 'FY25' } }]);
    const board = await meetingWith(env, '2026-09-05', [{ kind: 'simple' }], { kind: 'board' });
    const prt = minutesVersionsInternal(deps.db, assembly.meeting.id).at(-1)!.documentId;
    const vsp = minutesVersionsInternal(deps.db, board.meeting.id).at(-1)!.documentId;
    const mira = ctxWith(['finance.read', 'finance.overview', 'finance.audit'], insertUser(deps, { name: 'Mira', email: 'mira@kompass.local' }));
    const read = unwrap(await readAuditResolutionMinutes(deps, mira, { fiscalYearId: 'FY25', resolutionId: assembly.ids[0]! }));
    expect(read.bytes.byteLength).toBeGreaterThan(0);
    // Sonst nichts: weder das Protokoll über die Akte noch ein Vorstandsprotokoll, auch nicht über den Bezug.
    expect(await getDocument(deps, mira, prt)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getDocument(deps, mira, vsp)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await readLinkedDocument(deps, mira, { documentId: vsp, entityType: 'financeAuditResolutions', entityId: 'FY25' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await readLinkedDocument(deps, mira, { documentId: vsp, entityType: 'governanceMeeting', entityId: board.meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'governance.read' } });
    expect(await readAuditResolutionMinutes(deps, mira, { fiscalYearId: 'FY25', resolutionId: board.ids[0]! })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('Gremien off: null — finance shows eight sections', async () => {
    const env = setupGovernance(PERMISSIONS);
    const year = fiscalYears(env.deps);
    await meetingWith(env, '2025-03-14', [{ kind: 'accounts', details: { fiscalYearId: 'FY25' } }]);
    expect(auditResolutionsInternal(env.deps, env.deps.db, year)).toHaveLength(1);
    env.deps.db.transaction((tx) => writeSettingInternal(tx, env.deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(auditResolutionsInternal(env.deps, env.deps.db, year)).toBeNull();
  });
});
