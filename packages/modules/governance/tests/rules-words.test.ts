import { describe, expect, it } from 'vitest';
import { majorityPhrase, quorumPhrase, referenceOf } from '../src/rules/words';

describe('paper words of a rule', () => {
  it('names the usual majorities in words', () => {
    expect(majorityPhrase({ fraction: 'simple', base: 'cast', abstentions: 'ignored' }, 'assembly')).toBe('die Mehrheit der abgegebenen Stimmen');
    expect(majorityPhrase({ fraction: { num: 3, den: 4 }, base: 'cast', abstentions: 'ignored' }, 'assembly')).toBe('drei Viertel der abgegebenen Stimmen');
    expect(majorityPhrase({ fraction: { num: 1, den: 2 }, base: 'present', abstentions: 'ignored', comparison: 'moreThan' }, 'assembly')).toBe('mehr als die Hälfte der stimmberechtigten Anwesenden');
    expect(majorityPhrase({ fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' }, 'assembly')).toBe('die Zustimmung aller stimmberechtigten Mitglieder');
    expect(majorityPhrase({ fraction: { num: 1, den: 1 }, base: 'all', abstentions: 'asNo' }, 'board')).toBe('die Zustimmung aller Vorstandsmitglieder');
    expect(majorityPhrase({ fraction: { num: 5, den: 7 }, base: 'cast', abstentions: 'ignored' }, 'assembly')).toBe('5/7 der abgegebenen Stimmen');
    expect(majorityPhrase({ fraction: { num: 2, den: 3 }, base: 'all', abstentions: 'ignored' }, 'other')).toBe('zwei Drittel aller Mitglieder des Organs');
  });

  it('names the quorum and the reference or norm', () => {
    expect(quorumPhrase({ kind: 'none' }, 'assembly')).toBe('ohne Mindestzahl');
    expect(quorumPhrase({ kind: 'absolute', count: 2 }, 'board')).toBe('mindestens 2 Anwesende');
    expect(quorumPhrase({ kind: 'fraction', fraction: { num: 1, den: 4 }, base: 'allMembers' }, 'assembly')).toBe('ein Viertel aller Mitglieder');
    expect(referenceOf({ value: 1, source: 'statute', reference: '§ 9 Satzung' })).toBe('§ 9 Satzung');
    expect(referenceOf({ value: 1, source: 'law', norm: '§ 32 BGB' })).toBe('§ 32 BGB');
    expect(referenceOf({ value: 1, source: 'statute' })).toBe('Satzung');
  });
});
