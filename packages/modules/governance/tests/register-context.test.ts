import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { textPdf } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { fileSignedMinutes } from '../src/minutes/signed';
import { getFilingContext } from '../src/register/filing-context';
import { createRegisterFiling, updateRegisterFiling } from '../src/register/filings';
import { filingRequirements } from '../src/register/requirements';
import { governanceRegisterOccasions } from '../src/schema';
import { sealMeeting } from '../src/seal/seal';
import { endMeeting } from '../src/session';
import { elect, holders, officeOf, person, RECORDING, session, setupGovernance } from './helpers';

describe('getFilingContext', () => {
  it('names requirements, notary, predecessor and successor of a board change, and the overdue days', async () => {
    const { deps, ctx, userId } = setupGovernance([...RECORDING, 'dms.view']);
    await holders(deps, ctx, ['chair'], '2024-09-05');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    await elect(deps, ctx, items[0]!.id, officeOf(deps, 'chair'), await person(deps, 'Nachfolgerin'));
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    const occasion = deps.db.select().from(governanceRegisterOccasions).all().find((o) => o.kind === 'boardChange')!;
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: occasion.id }] }));
    const notary = await person(deps, 'Notarin');
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notaryContactId: notary, notarizedOn: '2026-09-05' }));

    const context = unwrap(await getFilingContext(deps, ctx, { filingId: filing.id }));
    expect(context.requirements).toEqual(unwrap(await filingRequirements(deps, ctx, { filingId: filing.id })));
    expect(context.notary).toEqual({ contactId: notary, name: 'Erika Notarin' });
    expect(context.occasions[0]).toMatchObject({ kind: 'boardChange', meetingKind: 'ordinary', heldOn: '2026-09-05', officeName: 'Vorsitz', before: 'Erika Amt chair 0', after: 'Erika Nachfolgerin' });
    expect(context.overdueDays).toBe(28);
    expect(context.representation).toMatchObject({ source: 'law' });
    expect(await getFilingContext(deps, ctxWith([], userId), { filingId: filing.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getFilingContext(deps, ctx, { filingId: 'fehlt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});
