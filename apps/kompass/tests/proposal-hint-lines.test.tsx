// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { HintLines } from '@/app/(shell)/animals/proposals/[id]/review-values';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>;
}
afterEach(cleanup);

describe('Zweifelsfall-Zeile (Designer 2026-10-10: wie der Punkt am Reiter)', () => {
  it('always says „Zweifelsfall“ in bold, a title of the source follows', () => {
    render(<HintLines hints={[{ title: 'Katzen', quote: 'Katzentest steht noch aus', suggestion: 'unbekannt' }]} />, { wrapper: Intl });
    const line = screen.getByTestId('proposal-hint');
    expect(line.querySelector('.font-semibold')?.textContent).toBe('Zweifelsfall');
    expect(line.textContent).toBe('Zweifelsfall · Katzen „Katzentest steht noch aus“ · Vorschlag: unbekannt');
  });
  it('without a title only „Zweifelsfall“ and the quote', () => {
    render(<HintLines hints={[{ quote: 'Alter geschätzt', suggestion: '' }]} />, { wrapper: Intl });
    expect(screen.getByTestId('proposal-hint').textContent).toBe('Zweifelsfall „Alter geschätzt“');
  });
});
