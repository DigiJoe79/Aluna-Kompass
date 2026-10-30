import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { auditorCandidates, financeFiscalYears } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditorCandidatesInternal } from '../src/finance-sources/auditors';
import { fileSignedMinutes, minutesVersionsInternal } from '../src/minutes/signed';
import { governanceResolutions } from '../src/schema';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { endTerm, startTerm } from '../src/terms';
import { elect, officeOf, person, RECORDING, session, setupGovernance } from './helpers';

const PERMISSIONS = [...RECORDING, 'finance.read', 'finance.periodClose'];

async function setup() {
  const env = setupGovernance(PERMISSIONS);
  env.deps.db.insert(financeFiscalYears).values({ id: 'FY25', startsOn: '2025-01-01', endsOn: '2025-12-31', designation: '2025', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
  const year = env.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, 'FY25')).get()!;
  return { ...env, year };
}

describe('auditor candidates from Gremien (G7)', () => {
  it('an auditor elected in a sealed assembly before the year: suggested with the day of the meeting, its minutes and the resolution', async () => {
    const { deps, ctx, year } = await setup();
    const irmgard = await person(deps, 'Schlehdorn', 'Irmgard');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2024-03-20' });
    const election = await elect(deps, ctx, items[0]!.id, officeOf(deps, 'auditor'), irmgard);
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const number = deps.db.select().from(governanceResolutions).where(eq(governanceResolutions.id, election.id)).get()!.number!;
    expect(auditorCandidatesInternal(deps, deps.db, year)).toEqual([
      { contactId: irmgard, name: 'Irmgard Schlehdorn', electedOn: '2024-03-20', minutesDocumentId: minutesVersionsInternal(deps.db, meeting.id).at(-1)!.documentId, source: { label: expect.stringContaining(number), href: `/governance/resolutions/${election.id}` } },
    ]);
    // Über die Finanzen: derselbe Vorschlag.
    expect(unwrap(await auditorCandidates(deps, ctx, { fiscalYearId: 'FY25' })).map((c) => c.contactId)).toEqual([irmgard]);
  });

  it('a holder whose term ended before the year is not suggested; a backfilled one without a resolution has no election day', async () => {
    const { deps, ctx, year } = await setup();
    const old = await person(deps, 'Früher', 'Frieda');
    const term = unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'auditor'), contactId: old, since: '2022-01-01', origin: 'backfilled' }));
    unwrap(await endTerm(deps, ctx, { id: term.id, until: '2024-12-31', reason: 'expired' }));
    const kasimir = await person(deps, 'Eibenhof', 'Kasimir');
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'auditor'), contactId: kasimir, since: '2025-03-20', origin: 'backfilled' }));
    expect(auditorCandidatesInternal(deps, deps.db, year).map((c) => [c.contactId, c.electedOn, c.minutesDocumentId])).toEqual([[kasimir, null, null]]);
  });

  it('Gremien off: none', async () => {
    const { deps, ctx, year } = await setup();
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'auditor'), contactId: await person(deps), since: '2025-03-20', origin: 'backfilled' }));
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(auditorCandidatesInternal(deps, deps.db, year)).toEqual([]);
  });
});
