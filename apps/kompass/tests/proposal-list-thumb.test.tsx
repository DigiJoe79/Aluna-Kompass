// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProposalThumb } from '@/app/(shell)/animals/proposals/proposal-list';

afterEach(cleanup);

/** Inbox: Ein neuer Hund zeigt das Titelbild seines Vorschlags, ein bestehender das heutige (Befund 10, Wilma/Ronja). */
describe('ProposalThumb', () => {
  it('shows the animal photo today when there is one', () => {
    const { container } = render(<ProposalThumb item={{ primaryAssetId: 'M1', primaryImageId: 'I1' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/media/M1/preview');
  });
  it('falls back to the cover image of the proposal (new dog)', () => {
    const { container } = render(<ProposalThumb item={{ primaryAssetId: null, primaryImageId: 'I1' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/animals/proposal-images/I1');
  });
  it('shows the empty circle without any image', () => {
    const { container } = render(<ProposalThumb item={{ primaryAssetId: null, primaryImageId: null }} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
