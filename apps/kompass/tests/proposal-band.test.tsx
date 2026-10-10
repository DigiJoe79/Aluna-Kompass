// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { OriginLine } from '@/app/(shell)/animals/origin-line';
import { ProposalBand } from '@/app/(shell)/animals/proposal-band';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>;
}
afterEach(cleanup);

describe('am Hund: offener Vorschlag und Herkunft (Board Vorschläge 7a)', () => {
  it('names the source, the fields and the photos and leads to the review page', () => {
    render(<ProposalBand proposal={{ id: 'P1', sourceName: 'Tierbörse', fields: ['sizeCm', 'summary'], photoCount: 2, kind: 'update' }} />, { wrapper: Intl });
    expect(screen.getByText('Offener Vorschlag von Tierbörse')).toBeTruthy();
    expect(screen.getByText('Größe (cm), Kurztext, 2 Fotos')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Prüfen' }).getAttribute('href')).toBe('/animals/proposals/P1');
  });

  it('shows the origin with a link to the entry at the source, or the name alone, or nothing', () => {
    const { rerender } = render(<OriginLine origins={[{ sourceName: 'Tierbörse', externalUrl: 'https://quelle.example/1' }]} />, { wrapper: Intl });
    const link = screen.getByRole('link', { name: 'Seite ansehen' });
    expect(link.getAttribute('href')).toBe('https://quelle.example/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(screen.getByTestId('animal-origin').textContent).toContain('Herkunft: Tierbörse');
    rerender(<OriginLine origins={[{ sourceName: 'Tierbörse', externalUrl: null }]} />);
    expect(screen.getByTestId('animal-origin').textContent).toBe('Herkunft: Tierbörse');
    rerender(<OriginLine origins={[]} />);
    expect(screen.queryByTestId('animal-origin')).toBeNull();
  });
});
