import { describe, expect, it } from 'vitest';
import { membershipStatus } from '../src/status';

const base = { appliedOn: '2026-01-10', admittedOn: null, rejectedOn: null, joinedOn: null, endsOn: null };
const today = '2026-09-05';

describe('membershipStatus', () => {
  it('an application neither admitted nor rejected is applied', () => {
    expect(membershipStatus(base, today)).toBe('applied');
  });

  it('a rejected application is rejected', () => {
    expect(membershipStatus({ ...base, rejectedOn: '2026-02-01' }, today)).toBe('rejected');
  });

  it('an admitted membership without end is active, also when it joins later', () => {
    expect(membershipStatus({ ...base, admittedOn: '2026-02-01', joinedOn: '2026-02-01' }, today)).toBe('active');
    expect(membershipStatus({ ...base, admittedOn: '2026-09-01', joinedOn: '2026-10-01' }, today)).toBe('active');
  });

  it('ends with the end of its last day: ending up to and including endsOn, ended the day after', () => {
    const admitted = { ...base, admittedOn: '2026-02-01', joinedOn: '2026-02-01' };
    expect(membershipStatus({ ...admitted, endsOn: '2026-12-31' }, today)).toBe('ending');
    expect(membershipStatus({ ...admitted, endsOn: today }, today)).toBe('ending');
    expect(membershipStatus({ ...admitted, endsOn: '2026-09-04' }, today)).toBe('ended');
  });

  it('a membership admitted without application (founding member) is active', () => {
    expect(membershipStatus({ ...base, appliedOn: null, admittedOn: '2020-05-01', joinedOn: '2020-05-01' }, today)).toBe('active');
  });
});
