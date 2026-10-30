import type { ElectionView, MeetingDetail, ResolutionView } from '@kompass/module-governance';
import { describe, expect, it } from 'vitest';
import { openPoints } from '@/lib/governance/open-points';

const resolution = (over: Partial<ResolutionView>): ResolutionView => ({ id: 'r', meetingId: 'm', circularId: null, agendaItemId: 'i1', organId: 'o', kind: 'simple', text: 'x', votedAt: '19:30', decidedOn: '2026-11-12', votes: null, yesComputed: false, unanimous: false, excluded: [], outcome: null, outcomeReason: null, details: null, number: null, createdAt: '', updatedAt: '', evaluation: null, warnings: [], ...over }) as ResolutionView;
const election = (elected: { contactId: string; acceptedOn: string | null; declinedOn: string | null }[], reachedBy: string[]): ElectionView =>
  ({ ...resolution({ id: 'e', kind: 'election', agendaItemId: 'i2', details: { officeId: 'o1', rounds: [], elected } }), rounds: [{ number: 1, reachedBy, needed: 2 }], runoffSuggested: null }) as unknown as ElectionView;
const detail = (resolutions: (ResolutionView | ElectionView)[]) => ({ agenda: [{ id: 'i1', position: 1 }, { id: 'i2', position: 2 }], resolutions }) as unknown as MeetingDetail;
const names = { c1: 'Lena Brückner' };

describe('openPoints (Schritt 4)', () => {
  it('a counted resolution without a finding is outcomeMissing', () => {
    expect(openPoints(detail([resolution({ votes: { yes: 3, no: 1, abstain: 0, invalid: 0 } })]), names)).toEqual([{ key: 'outcomeMissing:r', kind: 'outcomeMissing', itemNumber: 1 }]);
  });

  it('an election with a majority but no acceptance is acceptanceOpen with the name', () => {
    expect(openPoints(detail([election([], ['c1'])]), names)).toEqual([{ key: 'acceptanceOpen:e:c1', kind: 'acceptanceOpen', itemNumber: 2, name: 'Lena Brückner', contactId: 'c1', resolutionId: 'e' }]);
  });

  it('an accepted election and a postponed resolution are nothing open; a missing reason is', () => {
    expect(openPoints(detail([election([{ contactId: 'c1', acceptedOn: '2026-11-12', declinedOn: null }], ['c1']), resolution({ outcome: 'postponed' })]), names)).toEqual([]);
    expect(openPoints(detail([resolution({ outcome: 'adopted', warnings: ['outcomeAgainstCount', 'reasonMissing'] })]), names)).toEqual([{ key: 'reasonMissing:r', kind: 'reasonMissing', itemNumber: 1 }]);
  });
});
