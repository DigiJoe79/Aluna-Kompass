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

/**
 * 144/145 (Runde 3): Die Karte heißt nach ihrer Datei, die Verwendung steht gedämpft darunter — der Titel war sonst
 * dieselbe Angabe wie die Verwendung. Markiert wird nur „nicht verwendet“. 147: „Ausgewählt“ liegt auf dem Bild.
 */
describe('AssetGrid', () => {
  const items = [
    { id: 'A', filename: 'mira-3f2a9c.jpg', mimeType: 'image/jpeg', used: true, caption: 'Team: Mira' },
    { id: 'B', filename: 'flyer-77b1.pdf', mimeType: 'application/pdf', used: false },
  ];
  it('names the card after its file and keeps the use small below', () => {
    wrap(<AssetGrid items={items} onOpen={() => {}} />);
    const [used, unused] = screen.getAllByRole('button');
    expect(used!.textContent).toBe('mira-3f2a9c.jpgTeam: Mira');
    expect(screen.getByText('Team: Mira').className).toContain('text-muted-ink');
    expect(unused!.textContent).toContain('nicht verwendet');
    expect(screen.queryByText('verwendet', { exact: true })).toBeNull();
  });
  it('lays „Ausgewählt“ over the image, so the title keeps its width', () => {
    wrap(<AssetGrid items={items} selected={new Set(['A'])} onOpen={() => {}} />);
    expect(screen.getByText('Ausgewählt').closest('[data-asset-thumb]')).toBeTruthy();
  });
});
