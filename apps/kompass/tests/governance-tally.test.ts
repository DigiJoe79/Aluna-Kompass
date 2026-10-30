import { describe, expect, it } from 'vitest';
import { computeTally, quorumKnife, selfCountByDefault, type TallyInput } from '@/lib/governance/tally';

const threeQuarters = { fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored', comparison: 'atLeast' } as const;
const input = (over: Partial<TallyInput>): TallyInput => ({ kind: 'statute', voters: 14, presentVoting: 14, allVoting: 42, excluded: 0, majority: threeQuarters, tie: 'rejected', no: 0, abstain: 0, invalid: 0, yes: null, ...over });

describe('computeTally (HANDOFF Abnahme 2–5)', () => {
  it('14 voters, 3 no, 1 abstention: yes 10 computed, 13 cast, needs 10 — reached exactly on the threshold', () => {
    const r = computeTally(input({ no: 3, abstain: 1 }));
    expect(r).toMatchObject({ yes: 10, yesComputed: true, cast: 13, valid: true, knife: true, suggested: 'adopted' });
    expect(r.result).toMatchObject({ needed: 10, reached: true });
  });

  it('4 no: yes 9, not reached, rejected suggested', () => {
    expect(computeTally(input({ no: 4, abstain: 1 }))).toMatchObject({ yes: 9, knife: false, suggested: 'rejected', result: { reached: false } });
  });

  it('yes counted by hand overrides the computed one', () => {
    expect(computeTally(input({ no: 3, abstain: 1, yes: 9 }))).toMatchObject({ yes: 9, yesComputed: false });
  });

  it('more no than voters is not valid', () => {
    expect(computeTally(input({ no: 15 })).valid).toBe(false);
  });

  it('a tie the chair decides suggests nothing', () => {
    const simple = { fraction: 'simple', base: 'cast', abstentions: 'ignored' } as const;
    expect(computeTally(input({ kind: 'simple', majority: simple, tie: 'chairDecides', voters: 4, presentVoting: 4, no: 2 })).suggested).toBeNull();
  });
});

describe('selfCountByDefault and quorumKnife', () => {
  it('only statute, purpose and dissolution count yes by hand', () => {
    expect(['statute', 'purpose', 'dissolution', 'simple', 'election'].map((k) => selfCountByDefault(k as TallyInput['kind']))).toEqual([true, true, true, false, false]);
  });

  it('exactly on the quorum is the knife edge', () => {
    expect(quorumKnife(11, 11)).toBe(true);
    expect(quorumKnife(11, 12)).toBe(false);
    expect(quorumKnife(null, 3)).toBe(false);
  });
});
