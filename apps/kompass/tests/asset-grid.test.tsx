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
 * dieselbe Angabe wie die Verwendung. Markiert wird nur „nicht verwendet“.
 */
describe('AssetGrid', () => {
  const items = [
    { id: 'A', filename: 'mira-3f2a9c.jpg', mimeType: 'image/jpeg', used: true, caption: 'Team: Mira' },
    { id: 'B', filename: 'flyer-77b1.pdf', mimeType: 'application/pdf', used: false },
  ];
  it('marks only the unused file', () => {
    wrap(<AssetGrid items={items} onOpen={() => {}} />);
    const [, unused] = screen.getAllByRole('button');
    expect(unused!.textContent).toContain('nicht verwendet');
    expect(screen.queryByText('verwendet', { exact: true })).toBeNull();
  });

  it('renders AiKindBadge on the thumbnail when aiKind is present and not none', () => {
    const aiItems = [
      { id: 'A', filename: 'mira-3f2a9c.jpg', mimeType: 'image/jpeg', used: true, aiKind: 'edited' as const },
      { id: 'B', filename: 'flyer-77b1.pdf', mimeType: 'application/pdf', used: false, aiKind: 'none' as const },
    ];
    wrap(<AssetGrid items={aiItems} onOpen={() => {}} />);
    expect(screen.getAllByTestId('ai-kind-badge')).toHaveLength(1);
  });
});
