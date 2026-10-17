// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../messages/de.json';
import { KindBadge } from '@/app/(shell)/animals/proposals/kind-badge';
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

/** 049: Die Art ist eine Einordnung, keine Abweichung — Symbol und Wort als Text, ohne Marke und ohne Violett. */
describe('KindBadge', () => {
  it('shows the kind as text with a symbol, not as a badge', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <KindBadge kind="update" />
      </NextIntlClientProvider>,
    );
    const kind = screen.getByTestId('proposal-kind');
    expect(kind.textContent).toBe('Änderung');
    expect(kind.querySelector('svg')).toBeTruthy();
    expect(kind.className).not.toMatch(/agent|font-semibold|rounded/);
  });
});
