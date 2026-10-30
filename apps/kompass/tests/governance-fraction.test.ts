import { describe, expect, it } from 'vitest';
import { exampleNeeded, fromMajority, fromQuorum, toMajority, toQuorum } from '@/lib/governance/fraction';

describe('fraction ↔ model', () => {
  it('Review Focus 2: simple appears as more than 1/2 and goes back as simple', () => {
    const v = fromMajority({ fraction: 'simple', base: 'cast', abstentions: 'ignored' }, 'assembly');
    expect(v).toEqual({ comparison: 'moreThan', num: 1, den: 2, base: 'cast' });
    expect(toMajority(v, null)).toEqual({ fraction: 'simple', base: 'cast', abstentions: 'ignored' });
  });
  it('at least 1/2 stays a fraction; all at the board is the organ and back all; asNo survives', () => {
    const half = fromMajority({ fraction: { num: 1, den: 2 }, base: 'present', abstentions: 'ignored', comparison: 'atLeast' }, 'assembly');
    expect(half).toEqual({ comparison: 'atLeast', num: 1, den: 2, base: 'presentVoting' });
    expect(toMajority(half, null)).toEqual({ fraction: { num: 1, den: 2 }, base: 'present', abstentions: 'ignored', comparison: 'atLeast' });
    const board = fromMajority({ fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' }, 'board');
    expect(board.base).toBe('organMembers');
    expect(toMajority(board, { abstentions: 'asNo' })).toEqual({ fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo', comparison: 'atLeast' });
    expect(fromMajority({ fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' }, 'assembly').base).toBe('allMembers');
  });
  it('quorum round trip keeps votingMembers', () => {
    const q = { kind: 'fraction' as const, fraction: { num: 1, den: 4 }, base: 'votingMembers' as const, comparison: 'atLeast' as const };
    expect(toQuorum(fromQuorum(q))).toEqual(q);
    expect(fromQuorum({ fraction: { num: 1, den: 3 }, base: 'allMembers' })).toEqual({ comparison: 'atLeast', num: 1, den: 3, base: 'allMembers' });
  });
  it('board numbers of the example', () => {
    expect(exampleNeeded({ comparison: 'atLeast', num: 3, den: 4, base: 'cast' }, 13)).toBe(10);
    expect(exampleNeeded({ comparison: 'moreThan', num: 2, den: 3, base: 'cast' }, 9)).toBe(7);
    expect(exampleNeeded({ comparison: 'atLeast', num: 1, den: 4, base: 'allMembers' }, 42)).toBe(11);
  });
});
