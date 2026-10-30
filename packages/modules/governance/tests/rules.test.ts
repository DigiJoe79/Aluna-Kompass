import { describe, expect, it } from 'vitest';
import { LAW_NOTICE_HINT_DAYS } from '../src/rules/law';
import { resolveMajority, resolveRule } from '../src/rules/resolve';
import { rulesSchema, type StatuteRules } from '../src/rules/schema';

const MV = 'organ-mv';
const BOARD = 'organ-board';
const simple = (base: 'cast' | 'present') => ({ fraction: 'simple' as const, base, abstentions: 'ignored' as const });
const frac = (num: number, den: number, base: 'cast' | 'present' | 'all') => ({ fraction: { num, den }, base, abstentions: 'ignored' as const });

/** Das Regelwerk eines erfundenen Vereins mit den Werten aus Spec § 4.2. */
const example: StatuteRules = {
  organs: {
    [MV]: {
      noticeDays: 14,
      noticeStrictness: 'must',
      noticeFrom: 'received',
      form: 'textForm',
      agendaWithInvitation: true,
      motionDeadlineDays: 7,
      lateMotionMajority: frac(3, 4, 'cast'),
      quorum: { kind: 'fraction', fraction: { num: 1, den: 3 }, base: 'allMembers' },
      repeatMeeting: { withinDays: 28, noQuorum: true },
      majorities: { statute: frac(3, 4, 'present'), purpose: frac(9, 10, 'present'), dissolution: frac(9, 10, 'present') },
      election: { mode: 'single', rounds: [simple('present'), simple('cast')], runoff: true },
      minorityRequest: { num: 1, den: 10 },
    },
    [BOARD]: { noticeDays: 7, noticeStrictness: 'should', quorum: { kind: 'absolute', count: 2 }, tie: 'chairDecides', substitutionAllowed: true },
  },
  references: { [MV]: { quorum: '§ 13 Abs. 1 Satzung', 'majorities.statute': '§ 15 Satzung' } },
};

describe('rulesSchema', () => {
  it('takes a full set of rules', () => {
    expect(rulesSchema.safeParse(example).success).toBe(true);
    expect(rulesSchema.safeParse({ organs: {} }).success).toBe(true);
  });

  it('a fraction majority and a fraction quorum default to at least', () => {
    const parsed = rulesSchema.parse({ organs: { [MV]: { quorum: { kind: 'fraction', fraction: { num: 1, den: 3 }, base: 'allMembers' }, majorities: { statute: frac(3, 4, 'present') } } } });
    expect(parsed.organs[MV]!.majorities!.statute!.comparison).toBe('atLeast');
    expect(parsed.organs[MV]!.quorum).toMatchObject({ comparison: 'atLeast' });
    expect(rulesSchema.safeParse({ organs: { [MV]: { majorities: { statute: { ...frac(3, 4, 'present'), comparison: 'moreThan' } } } } }).success).toBe(true);
    expect(rulesSchema.safeParse({ organs: { [MV]: { majorities: { statute: { ...frac(3, 4, 'present'), comparison: 'over' } } } } }).success).toBe(false);
  });

  it('refuses a fraction above one and unknown keys', () => {
    expect(rulesSchema.safeParse({ organs: { [MV]: { minorityRequest: { num: 3, den: 2 } } } }).success).toBe(false);
    expect(rulesSchema.safeParse({ organs: { [MV]: { minorityRequest: { num: 0, den: 2 } } } }).success).toBe(false);
    expect(rulesSchema.safeParse({ organs: { [MV]: { quorom: { kind: 'none' } } } }).success).toBe(false);
  });
});

describe('resolveRule', () => {
  it('tells a missing quorum (law) from a statute without quorum (Review Focus 3)', () => {
    expect(resolveRule({ organs: {} }, MV, 'quorum')).toMatchObject({ value: { kind: 'none' }, source: 'law' });
    expect(resolveRule({ organs: { [MV]: { quorum: { kind: 'none' } } } }, MV, 'quorum')).toEqual({ value: { kind: 'none' }, source: 'statute' });
  });

  it('returns the reference of a statute rule and the norm of a fallback', () => {
    expect(resolveRule(example, MV, 'quorum')).toMatchObject({ source: 'statute', reference: '§ 13 Abs. 1 Satzung' });
    expect(resolveRule(example, MV, 'minorityRequest')).toMatchObject({ source: 'statute', value: { num: 1, den: 10 } });
    expect(resolveRule({ organs: {} }, MV, 'minorityRequest')).toMatchObject({ source: 'law', value: { num: 1, den: 10 }, norm: '§ 37 Abs. 1 BGB' });
    expect(resolveRule(example, BOARD, 'substitutionAllowed')).toMatchObject({ source: 'statute', value: true });
    expect(resolveRule({ organs: {} }, BOARD, 'substitutionAllowed')).toMatchObject({ source: 'law', value: false });
  });

  it('board representation: the statute rule with its reference, else the majority of the board by law', () => {
    const rules: StatuteRules = { organs: { [BOARD]: { representation: { mode: 'two', text: 'je zwei Vorstandsmitglieder gemeinsam' } } }, references: { [BOARD]: { representation: '§ 9 Abs. 2 Satzung' } } };
    expect(rulesSchema.safeParse(rules).success).toBe(true);
    expect(rulesSchema.safeParse({ organs: { [BOARD]: { representation: { mode: 'three' } } } }).success).toBe(false);
    expect(resolveRule(rules, BOARD, 'representation')).toEqual({ value: { mode: 'two', text: 'je zwei Vorstandsmitglieder gemeinsam' }, source: 'statute', reference: '§ 9 Abs. 2 Satzung' });
    expect(resolveRule({ organs: {} }, BOARD, 'representation')).toEqual({ value: { mode: 'majority' }, source: 'law', norm: '§ 26 Abs. 2 S. 1 BGB' });
  });

  it('has no notice period by law, only a hint', () => {
    expect(resolveRule({ organs: {} }, MV, 'noticeDays')).toMatchObject({ value: undefined, source: 'law' });
    expect(LAW_NOTICE_HINT_DAYS).toBe(14);
    expect(resolveRule({ organs: {} }, MV, 'noticeFrom')).toMatchObject({ value: 'received', source: 'law' });
  });
});

describe('resolveMajority', () => {
  it('falls back to three quarters of the votes cast for a statute change', () => {
    expect(resolveMajority({ organs: {} }, MV, 'statute')).toEqual({ value: frac(3, 4, 'cast'), source: 'law', norm: '§ 33 Abs. 1 S. 1 BGB' });
    expect(resolveMajority({ organs: {} }, MV, 'purpose')).toMatchObject({ value: { fraction: { num: 1, den: 1 }, base: 'all' }, source: 'law' });
    expect(resolveMajority({ organs: {} }, MV, 'discharge')).toMatchObject({ value: simple('cast'), source: 'law' });
  });

  it('takes the statute value with its reference', () => {
    expect(resolveMajority(example, MV, 'statute')).toEqual({ value: frac(3, 4, 'present'), source: 'statute', reference: '§ 15 Satzung' });
    expect(resolveMajority(example, BOARD, 'statute')).toMatchObject({ source: 'law' });
  });
});
