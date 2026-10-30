import type { StatuteRules } from '@kompass/module-governance';
import { describe, expect, it } from 'vitest';
import { mergeRules, ruleRowsFor } from '@/lib/governance/rule-rows';

const MV = 'mv';
const BOARD = 'board';
/** Wie das Regelwerk des Seeds (`seed.ts` rulesFor), dazu Regeln, die die Seite nicht als eigene Eingabe kennt. */
const SEED: StatuteRules = {
  organs: {
    [MV]: {
      noticeDays: 14,
      noticeStrictness: 'must',
      noticeFrom: 'received',
      transitDays: { email: 1, post: 4 },
      form: 'textForm',
      motionDeadlineDays: 7,
      quorum: { kind: 'fraction', fraction: { num: 1, den: 4 }, base: 'allMembers' },
      repeatMeeting: { withinDays: 28, noQuorum: true },
      majorities: { statute: { fraction: { num: 3, den: 4 }, base: 'present', abstentions: 'ignored' }, feeSchedule: { fraction: 'simple', base: 'cast', abstentions: 'asNo' } },
      election: { mode: 'single', rounds: [{ fraction: 'simple', base: 'present', abstentions: 'ignored' }], runoff: true },
      announceRequired: ['statute', 'purpose'],
      chairOrder: ['o1', 'o2'],
      convenedBy: { officeIds: ['o1'] },
      formsAllowed: ['inPerson'],
      minorityRequest: { num: 1, den: 5 },
      exclusionNoticeDays: 14,
    },
    [BOARD]: { noticeDays: 7, quorum: { kind: 'absolute', count: 2 }, tie: 'chairDecides', substitutionAllowed: true, representation: { mode: 'two', text: 'Zwei gemeinsam.' }, remuneration: { statuteReference: '§ 8', decidedBy: MV } },
  },
  references: { [MV]: { quorum: '§ 9 Abs. 2 Satzung', 'majorities.statute': '§ 12 Abs. 1 Satzung' }, [BOARD]: { representation: '§ 7 Abs. 2 Satzung' } },
  assetBeneficiary: 'Tierschutzbund',
};

describe('ruleRowsFor', () => {
  it('the board has representation, the assembly not; every row has a group', () => {
    const board = ruleRowsFor({ id: BOARD, kind: 'board' }, SEED);
    const mv = ruleRowsFor({ id: MV, kind: 'assembly' }, SEED);
    expect(board.map((r) => r.key)).toContain('representation');
    expect(mv.map((r) => r.key)).not.toContain('representation');
    expect(mv.every((r) => r.group)).toBe(true);
  });
  it('seed assembly: quorum from the statute with its reference, purpose from the law with its norm', () => {
    const mv = ruleRowsFor({ id: MV, kind: 'assembly' }, SEED);
    expect(mv.find((r) => r.key === 'quorum')).toMatchObject({ source: 'statute', reference: '§ 9 Abs. 2 Satzung', norm: null });
    expect(mv.find((r) => r.key === 'majority.purpose')).toMatchObject({ source: 'law', reference: null, norm: '§ 33 Abs. 1 S. 2 BGB' });
  });
  it('Review Focus 5: a statute value equal to the law stays a statute rule', () => {
    const rules: StatuteRules = { organs: { [MV]: { quorum: { kind: 'none' } } } };
    expect(ruleRowsFor({ id: MV, kind: 'assembly' }, rules).find((r) => r.key === 'quorum')!.source).toBe('statute');
    expect(ruleRowsFor({ id: MV, kind: 'assembly' }, { organs: {} }).find((r) => r.key === 'quorum')!.source).toBe('law');
  });
});

describe('mergeRules', () => {
  it('Review Focus 1: keeps everything not edited, deep equal', () => {
    const merged = mergeRules(SEED, MV, { majorities: { purpose: { fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' } } }, [], {});
    const { majorities, ...rest } = merged.organs[MV]!;
    const { majorities: before, ...restBefore } = SEED.organs[MV]!;
    expect(rest).toEqual(restBefore);
    expect(majorities).toEqual({ ...before, purpose: { fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' } });
    expect(merged.organs[BOARD]).toEqual(SEED.organs[BOARD]);
    expect(merged.references).toEqual(SEED.references);
    expect(merged.assetBeneficiary).toBe('Tierschutzbund');
  });
  it('removed goes back to the law with its reference; an empty reference removes the key', () => {
    const merged = mergeRules(SEED, MV, {}, ['majorities.statute', 'quorum'], { motionDeadlineDays: '§ 10 Satzung', 'majorities.statute': '' });
    expect(merged.organs[MV]!.majorities).toEqual({ feeSchedule: SEED.organs[MV]!.majorities!.feeSchedule });
    expect(merged.organs[MV]!.quorum).toBeUndefined();
    expect(merged.references![MV]).toEqual({ motionDeadlineDays: '§ 10 Satzung' });
    expect(SEED.organs[MV]!.quorum).toBeDefined();
  });
});
