// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { AssetGrid } from '@/components/media/asset-grid';

afterEach(cleanup);

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

/** 10 A6, 10 B29, 10 B30: Die Karte heißt nach ihrer Verwendung, der Dateiname steht klein; markiert wird nur „nicht verwendet“. */
describe('AssetGrid', () => {
  const items = [
    { id: 'A', filename: 'mira-3f2a9c.jpg', mimeType: 'image/jpeg', used: true, caption: 'Team: Mira' },
    { id: 'B', filename: 'flyer-77b1.pdf', mimeType: 'application/pdf', used: false },
  ];
  it('names the card after its use and keeps the file name small', () => {
    wrap(<AssetGrid items={items} onOpen={() => {}} />);
    const [used, unused] = screen.getAllByRole('button');
    expect(used!.textContent).toBe('Team: Miramira-3f2a9c.jpg');
    expect(screen.getByText('mira-3f2a9c.jpg').className).toContain('text-muted-ink');
    expect(unused!.textContent).toContain('nicht verwendet');
    expect(screen.queryByText('verwendet', { exact: true })).toBeNull();
  });
});
