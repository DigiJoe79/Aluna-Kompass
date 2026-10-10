import { describe, expect, it } from 'vitest';
import { animalViewTabs } from '@/app/(shell)/animals/view-tabs';

const base = { canManage: true, reviewSetting: false, reviewPendingTotal: 0, proposalsSetting: true, openProposals: 0 };

describe('animalViewTabs (Spec Vorschläge § 4, § 6; Board 1d/1e)', () => {
  it('shows proposals in place of review for a manager with proposals on', () => expect(animalViewTabs(base)).toEqual(['all', 'proposals']));
  it('shows both with the review setting on (Board 1e)', () => expect(animalViewTabs({ ...base, reviewSetting: true })).toEqual(['all', 'review', 'proposals']));
  it('keeps review while animals are still marked, proposals while some are open', () => {
    expect(animalViewTabs({ ...base, proposalsSetting: false, reviewPendingTotal: 2 })).toEqual(['all', 'review']);
    expect(animalViewTabs({ ...base, proposalsSetting: false, openProposals: 1 })).toEqual(['all', 'proposals']);
    expect(animalViewTabs({ ...base, proposalsSetting: false })).toEqual(['all']);
  });
  it('never shows proposals without animals.manage', () => expect(animalViewTabs({ ...base, canManage: false, openProposals: 3 })).toEqual(['all']));
});
