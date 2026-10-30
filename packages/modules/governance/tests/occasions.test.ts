import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveOffice } from '../src/offices';
import { governanceOffices, governanceRegisterOccasions } from '../src/schema';
import { endTerm, listTerms, startTerm } from '../src/terms';
import { auditOf, holders, officeOf, person, setupGovernance } from './helpers';

describe('register occasions from terms and offices', () => {
  it('a resignation from the chair is a board change; an auditor leaving is none', async () => {
    const { deps, ctx } = setupGovernance();
    await holders(deps, ctx, ['chair', 'auditor']);
    const [chairTerm] = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'chair') }));
    const [auditorTerm] = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'auditor') }));
    unwrap(await endTerm(deps, ctx, { id: chairTerm!.id, until: '2026-05-31', reason: 'resigned', receivedOn: '2026-05-20' }));
    unwrap(await endTerm(deps, ctx, { id: auditorTerm!.id, until: '2026-05-31', reason: 'resigned', receivedOn: '2026-05-20' }));
    expect(deps.db.select().from(governanceRegisterOccasions).all()).toEqual([
      expect.objectContaining({ kind: 'boardChange', occurredOn: '2026-05-31', termId: chairTerm!.id, officeId: officeOf(deps, 'chair'), meetingId: null, resolutionId: null, filingId: null }),
    ]);
  });

  it('a court appointment is none (§ 67 Abs. 2 BGB), a substitute is a board change', async () => {
    const { deps, ctx } = setupGovernance();
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'chair'), contactId: await person(deps, 'Notvorstand'), since: '2026-06-01', origin: 'courtAppointed' }));
    expect(deps.db.select().from(governanceRegisterOccasions).all()).toEqual([]);
    unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'board'), contactId: await person(deps, 'Ersatz'), since: '2026-06-01', origin: 'substitute' }));
    expect(deps.db.select().from(governanceRegisterOccasions).all().map((o) => [o.kind, o.occurredOn])).toEqual([['boardChange', '2026-06-01']]);
  });

  it('changing the representation of an office is an occasion', async () => {
    const { deps, ctx } = setupGovernance();
    const office = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const { id, organId, name, seats, termMonths, untilSuccessor, function: fn, incompatibleWith } = office;
    unwrap(await saveOffice(deps, ctx, { id, organId, name: `${name} neu`, seats, representative: true, termMonths, untilSuccessor, function: fn, incompatibleWith }));
    expect(deps.db.select().from(governanceRegisterOccasions).all()).toEqual([]);
    unwrap(await saveOffice(deps, ctx, { id, organId, name, seats: 2, representative: true, termMonths, untilSuccessor, function: fn, incompatibleWith }));
    expect(deps.db.select().from(governanceRegisterOccasions).all().map((o) => [o.kind, o.officeId])).toEqual([['representation', id]]);
  });

  it('V-6: switching the representation back the same way withdraws the open occasion of that office', async () => {
    const { deps, ctx } = setupGovernance();
    const office = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const { id, organId, name, seats, termMonths, untilSuccessor, function: fn, incompatibleWith } = office;
    const save = async (representative: boolean) => unwrap(await saveOffice(deps, ctx, { id, organId, name, seats, representative, termMonths, untilSuccessor, function: fn, incompatibleWith }));
    const open = () => deps.db.select().from(governanceRegisterOccasions).all().map((o) => [o.kind, o.officeId]);
    await save(!office.representative);
    expect(open()).toEqual([['representation', id]]);
    await save(office.representative);
    expect(open()).toEqual([]);
    expect(auditOf(deps, 'governance.registerOccasion.withdraw').map((e) => e.params)).toEqual([{ kind: 'representation', occurredOn: expect.any(String) }]);
  });
});
