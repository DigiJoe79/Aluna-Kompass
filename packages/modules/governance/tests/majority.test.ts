import { describe, expect, it } from 'vitest';
import { evaluateMajority, votesValid, type Votes } from '../src/majority';
import type { Majority } from '../src/rules/schema';

const threeQuarters = (base: Majority['base']): Majority => ({ fraction: { num: 3, den: 4 }, base, abstentions: 'ignored' });
const simple: Majority = { fraction: 'simple', base: 'cast', abstentions: 'ignored' };
const run = (majority: Majority, votes: Votes, presentVoting = 7, extra: { allVoting?: number; excluded?: number; tie?: 'rejected' | 'chairDecides' } = {}) =>
  evaluateMajority({ majority, votes, presentVoting, allVoting: extra.allVoting ?? presentVoting, excluded: extra.excluded ?? 0, tie: extra.tie ?? 'rejected' });

describe('evaluateMajority', () => {
  it('Review Focus 3: abstentions and invalid votes are not cast', () => {
    const withAbstention = { yes: 5, no: 1, abstain: 1, invalid: 0 };
    expect(run(threeQuarters('present'), withAbstention)).toMatchObject({ denominator: 7, needed: 6, reached: false });
    expect(run(threeQuarters('cast'), withAbstention)).toMatchObject({ denominator: 6, needed: 5, reached: true });
    const withInvalid = { yes: 5, no: 1, abstain: 0, invalid: 1 };
    expect(run(threeQuarters('present'), withInvalid).reached).toBe(false);
    expect(run(threeQuarters('cast'), withInvalid).reached).toBe(true);
  });

  it('a tie under simple majority is rejected or left to the chair', () => {
    const tie = { yes: 3, no: 3, abstain: 0, invalid: 0 };
    expect(run(simple, tie, 6)).toMatchObject({ tie: true, reached: false });
    expect(run(simple, tie, 6, { tie: 'chairDecides' })).toMatchObject({ tie: true, reached: null });
    expect(run(simple, { yes: 4, no: 3, abstain: 2, invalid: 0 }, 9)).toMatchObject({ tie: false, reached: true, denominator: 7 });
  });

  it('purpose: all members (1/1 of all) — eight of nine is not enough', () => {
    const all: Majority = { fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' };
    expect(run(all, { yes: 8, no: 0, abstain: 0, invalid: 0 }, 8, { allVoting: 9 })).toMatchObject({ denominator: 9, needed: 9, reached: false });
    expect(run(all, { yes: 9, no: 0, abstain: 0, invalid: 0 }, 9, { allVoting: 9 }).reached).toBe(true);
  });

  it('abstentions as no count against the motion', () => {
    const asNo: Majority = { fraction: 'simple', base: 'cast', abstentions: 'asNo' };
    expect(run(asNo, { yes: 3, no: 1, abstain: 2, invalid: 0 })).toMatchObject({ denominator: 6, reached: false, tie: true });
    expect(run(asNo, { yes: 4, no: 1, abstain: 2, invalid: 0 })).toMatchObject({ denominator: 7, reached: true });
  });

  it('excluded voters leave the base present', () => {
    expect(run(threeQuarters('present'), { yes: 3, no: 0, abstain: 1, invalid: 0 }, 7, { excluded: 3 })).toMatchObject({ denominator: 4, needed: 3, reached: true });
  });
});

describe('evaluateMajority — comparison', () => {
  const twoThirds = (comparison: 'atLeast' | 'moreThan'): Majority => ({ fraction: { num: 2, den: 3 }, base: 'present', abstentions: 'ignored', comparison });
  const threeQuartersOf = (comparison: 'atLeast' | 'moreThan'): Majority => ({ fraction: { num: 3, den: 4 }, base: 'present', abstentions: 'ignored', comparison });
  const none = { yes: 0, no: 0, abstain: 0, invalid: 0 };

  it('at least rounds up, more than needs the next whole vote above the fraction', () => {
    expect(run(twoThirds('atLeast'), none, 9).needed).toBe(6);
    expect(run(twoThirds('moreThan'), none, 9).needed).toBe(7);
    expect(run(twoThirds('atLeast'), none, 10).needed).toBe(7);
    expect(run(twoThirds('moreThan'), none, 10).needed).toBe(7);
    expect(run(threeQuartersOf('atLeast'), none, 8).needed).toBe(6);
    expect(run(threeQuartersOf('moreThan'), none, 8).needed).toBe(7);
  });

  it('without comparison a fraction means at least (existing rules)', () => {
    expect(run(threeQuarters('present'), none, 8).needed).toBe(6);
    expect(run(threeQuartersOf('moreThan'), { yes: 6, no: 2, abstain: 0, invalid: 0 }, 8).reached).toBe(false);
  });
});

describe('votesValid', () => {
  it('no more votes than voters without the excluded', () => {
    expect(votesValid({ yes: 4, no: 1, abstain: 1, invalid: 0 }, 7, 1)).toBe(true);
    expect(votesValid({ yes: 4, no: 1, abstain: 1, invalid: 1 }, 7, 1)).toBe(false);
  });
});
