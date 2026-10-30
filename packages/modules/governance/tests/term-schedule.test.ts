import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { governanceOffices } from '../src/schema';
import { boardLeaderlessInternal, officesDueInternal, termScheduledEnd } from '../src/term-schedule';
import { saveOffice } from '../src/offices';
import { startTerm } from '../src/terms';
import { person, setupGovernance, type GovernanceDeps } from './helpers';

const office = (deps: GovernanceDeps, fn: 'chair' | 'board' | 'treasurer' | 'auditor') => deps.db.select().from(governanceOffices).all().find((o) => o.function === fn)!;

describe('termScheduledEnd', () => {
  it('ends the day before the corresponding day, at the end of a short month, or never', () => {
    const o = { termMonths: 24, untilSuccessor: true };
    expect(termScheduledEnd({ since: '2026-07-20', until: null }, o)).toBe('2028-07-19');
    expect(termScheduledEnd({ since: '2026-08-31', until: null }, { ...o, termMonths: 6 })).toBe('2027-02-28');
    expect(termScheduledEnd({ since: '2027-03-01', until: null }, { ...o, termMonths: 12 })).toBe('2028-02-29');
    expect(termScheduledEnd({ since: '2026-07-20', until: '2027-01-31' }, o)).toBe('2027-01-31');
    expect(termScheduledEnd({ since: '2026-07-20', until: null }, { termMonths: null, untilSuccessor: false })).toBeNull();
  });
});

describe('officesDueInternal and boardLeaderlessInternal', () => {
  it('reports a free auditor seat and a term ending within six months', async () => {
    const { deps, ctx } = setupGovernance();
    const auditor = office(deps, 'auditor');
    const chair = office(deps, 'chair');
    unwrap(await startTerm(deps, ctx, { officeId: auditor.id, contactId: await person(deps, 'Prüf'), since: '2025-01-01', origin: 'backfilled' }));
    const chairTerm = unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps, 'Vorsitz'), since: '2025-01-01', origin: 'backfilled' }));
    const due = officesDueInternal(deps.db, '2026-09-01');
    expect(due).toContainEqual({ officeId: auditor.id, organId: auditor.organId, reason: 'vacant', termId: null, endsOn: null });
    expect(due).toContainEqual({ officeId: chair.id, organId: chair.organId, reason: 'ending', termId: chairTerm.id, endsOn: '2026-12-31' });
    // Die Prüfung hat ihre Amtszeit erst 2026-12-31 erfüllt — sie zählt auch als endend.
    expect(due.filter((d) => d.reason === 'ending').map((d) => d.officeId).sort()).toEqual([auditor.id, chair.id].sort());
    expect(officesDueInternal(deps.db, '2026-01-01').filter((d) => d.reason === 'ending')).toEqual([]);
  });

  it('calls the board leaderless once every representative term without untilSuccessor has run out', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = office(deps, 'chair');
    expect(boardLeaderlessInternal(deps.db, '2026-03-01')).toBe(false);
    for (const fn of ['chair', 'board', 'treasurer'] as const) {
      const o = office(deps, fn);
      unwrap(await saveOffice(deps, ctx, { id: o.id, organId: o.organId, name: o.name, seats: 1, representative: o.representative, termMonths: 24, untilSuccessor: false, function: o.function, incompatibleWith: [] }));
    }
    unwrap(await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps, 'Vorsitz'), since: '2024-01-01', origin: 'backfilled' }));
    expect(boardLeaderlessInternal(deps.db, '2025-12-31')).toBe(false);
    expect(boardLeaderlessInternal(deps.db, '2026-01-01')).toBe(true);
    unwrap(await saveOffice(deps, ctx, { id: chair.id, organId: chair.organId, name: chair.name, seats: 1, representative: true, termMonths: 24, untilSuccessor: true, function: 'chair', incompatibleWith: [] }));
    expect(boardLeaderlessInternal(deps.db, '2026-01-01')).toBe(false);
  });
});

describe('a substitute appointment runs until the next election (G-19)', () => {
  it('has no scheduled end and is always due for election', async () => {
    const { deps, ctx } = setupGovernance();
    const treasurer = office(deps, 'treasurer');
    const term = unwrap(await startTerm(deps, ctx, { officeId: treasurer.id, contactId: await person(deps, 'Ersatz'), since: '2026-06-01', origin: 'substitute' }));
    expect(termScheduledEnd(term, treasurer)).toBeNull();
    expect(officesDueInternal(deps.db, '2026-09-05')).toContainEqual({ officeId: treasurer.id, organId: treasurer.organId, reason: 'ending', termId: term.id, endsOn: null });
  });
});
