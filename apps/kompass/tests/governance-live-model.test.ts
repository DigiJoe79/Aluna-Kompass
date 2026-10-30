import type { AgendaItemView, ElectionView, MotionView, ResolutionView } from '@kompass/module-governance';
import { describe, expect, it } from 'vitest';
import type { VoteTallyValue } from '@/components/governance/vote-tally';
import { dischargeLabels, dischargeModeLocked, itemSummary, liveEntries, recountAfterDeparture, scopeOf } from '@/lib/governance/live-model';

const item = (over: Partial<AgendaItemView> = {}): AgendaItemView => ({ id: 'i1', meetingId: 'm', position: 1, kind: 'simple', title: 'Zelt', invitationText: null, proposal: null, attachmentDocumentIds: [], officeIds: [], fiscalYearId: null, statuteId: null, motionId: null, minutesNote: null, addedDuring: 'preparation', createdAt: '', updatedAt: '', warnings: [], ...over }) as AgendaItemView;
const resolution = (over: Partial<ResolutionView> = {}): ResolutionView => ({ id: 'r1', meetingId: 'm', circularId: null, agendaItemId: 'i1', organId: 'o', kind: 'simple', text: 'x', votedAt: '19:30', decidedOn: '2026-11-12', votes: null, yesComputed: false, unanimous: false, excluded: [], outcome: null, outcomeReason: null, details: null, number: null, createdAt: '', updatedAt: '', evaluation: null, warnings: [], ...over }) as ResolutionView;

describe('itemSummary', () => {
  it('unanimous adopted is „einstimmig“ and done', () => {
    expect(itemSummary(item(), [resolution({ unanimous: true, votes: { yes: 7, no: 0, abstain: 0, invalid: 0 }, outcome: 'adopted' })], {}, false)).toEqual({ summary: { key: 'unanimous' }, done: true, mark: null });
  });

  it('counted without a finding is not done', () => {
    expect(itemSummary(item(), [resolution({ votes: { yes: 5, no: 2, abstain: 0, invalid: 0 } })], {}, false).done).toBe(false);
  });

  it('against the count with a reason is marked; a missing reason is „Begründung fehlt“ and not done', () => {
    expect(itemSummary(item(), [resolution({ votes: { yes: 2, no: 5, abstain: 0, invalid: 0 }, outcome: 'adopted', outcomeReason: 'Zählfehler', warnings: ['outcomeAgainstCount'] })], {}, false)).toMatchObject({ done: true, mark: 'againstCount' });
    expect(itemSummary(item(), [resolution({ votes: { yes: 2, no: 5, abstain: 0, invalid: 0 }, outcome: 'adopted', warnings: ['outcomeAgainstCount', 'reasonMissing'] })], {}, false)).toMatchObject({ done: false, mark: 'reasonMissing' });
    expect(itemSummary(item(), [resolution({ votes: { yes: 2, no: 5, abstain: 0, invalid: 0 }, outcome: null })], {}, true)).toMatchObject({ done: false, mark: 'reasonMissing' });
  });

  it('an accepted election names the person', () => {
    const election = { ...resolution({ kind: 'election', details: { officeId: 'o1', rounds: [], elected: [{ contactId: 'c1', acceptedOn: '2026-11-12', declinedOn: null }] } }), rounds: [], runoffSuggested: null } as unknown as ElectionView;
    expect(itemSummary(item({ kind: 'election' }), [election], { c1: 'Lena Brückner' }, false)).toEqual({ summary: { key: 'elected', name: 'Lena Brückner' }, done: true, mark: null });
  });

  it('a report with a note is noted', () => {
    expect(itemSummary(item({ kind: 'report', minutesNote: 'Bericht gehört.' }), [], {}, false)).toEqual({ summary: { key: 'noted' }, done: true, mark: null });
  });
});

describe('liveEntries', () => {
  it('a late motion without an item comes after the last item', () => {
    const motion = { id: 'mo', meetingId: 'm', submittedByContactId: null, receivedOn: '2026-11-12', text: 'Zelt kaufen', documentId: null, agendaItemId: null, withdrawnOn: null, createdAt: '', updatedAt: '', late: true } as MotionView;
    const entries = liveEntries([item(), item({ id: 'i2', position: 2, title: 'Verschiedenes', kind: 'other' })], [], [motion], {}, new Set());
    expect(entries.map((e) => e.key)).toEqual(['i1', 'i2', 'motion:mo']);
    expect(entries[2]).toMatchObject({ number: '3', lateMotion: true });
    // Aus der Versammlung ohne Antragsfrist: nicht „nach Frist“, aber mit offener Abstimmung über die Aufnahme.
    const floor = { ...motion, id: 'fl', late: false };
    const admission = resolution({ id: 'adm', kind: 'agenda', agendaItemId: null, details: { motionId: 'fl', kind: 'simple' } });
    expect(liveEntries([item()], [admission], [floor, { ...motion, id: 'other', late: false }], {}, new Set()).map((e) => e.key)).toEqual(['i1', 'motion:fl']);
  });
});

describe('recountAfterDeparture (Review Focus 2)', () => {
  const v = (over: Partial<VoteTallyValue>): VoteTallyValue => ({ mode: 'counting', no: 1, abstain: 0, invalid: 0, yes: null, outcome: null, reason: '', recountNote: null, ...over });
  it('only a computed yes is recounted', () => {
    expect(recountAfterDeparture(v({}))).toBe(true);
    expect(recountAfterDeparture(v({ yes: 9 }))).toBe(false);
    expect(recountAfterDeparture(v({ mode: 'unanimous' }))).toBe(false);
  });
});

describe('discharge (Task 10, Review Focus 5)', () => {
  const discharge = (id: string, contactIds: string[], mode: 'individual' | 'collective') => resolution({ id, kind: 'discharge', agendaItemId: 'i5', details: { fiscalYearId: 'fy', mode, contactIds }, excluded: contactIds.map((contactId) => ({ contactId, reason: 'discharge', note: null })) });
  const present = (ids: string[], extra = 0) => ({ persons: ids.length + extra, members: ids.length + extra, voting: ids.length + extra, organMembers: 0, contactIds: ids, votingContactIds: ids });

  it('labels individual resolutions 5a, 5b, 5c; a collective one has no letter', () => {
    const rs = [discharge('a', ['x'], 'individual'), discharge('b', ['y'], 'individual'), discharge('c', ['z'], 'individual')];
    expect(dischargeLabels(rs, 5)).toEqual({ a: '5a', b: '5b', c: '5c' });
    expect(dischargeLabels([discharge('g', ['x', 'y', 'z'], 'collective')], 5)).toEqual({ g: '5' });
  });

  it('the strip counts without the present persons concerned: collective 14 − 3 = 11, individually 13; an absent one is not subtracted', () => {
    const p = present(['x', 'y', 'z'], 11);
    expect(scopeOf(item({ id: 'i5', position: 5, kind: 'discharge' }), [discharge('g', ['x', 'y', 'z'], 'collective')], p, 'g')).toEqual({ itemNumber: 5, present: 11 });
    expect(scopeOf(item({ id: 'i5', position: 5, kind: 'discharge' }), [discharge('a', ['x'], 'individual'), discharge('b', ['y'], 'individual')], p, 'a')).toEqual({ itemNumber: 5, present: 13 });
    expect(scopeOf(item({ id: 'i5', position: 5, kind: 'discharge' }), [discharge('g', ['x', 'absent'], 'collective')], p, 'g')).toEqual({ itemNumber: 5, present: 13 });
    expect(scopeOf(item({ id: 'i2', position: 2 }), [], p, null)).toBeNull();
  });

  it('the mode is fixed once a discharge resolution exists at the item', () => {
    expect(dischargeModeLocked([], 'i5')).toBe(false);
    expect(dischargeModeLocked([discharge('g', ['x'], 'collective')], 'i5')).toBe(true);
  });
});
