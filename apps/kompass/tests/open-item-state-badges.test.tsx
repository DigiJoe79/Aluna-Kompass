// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { OpenItemStateBadges } from '@/app/(shell)/finance/open-items/list';

afterEach(cleanup);
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

/** Runde 3, 097/098: eine Marke je Zeile; „offen“ ist der Normalfall, in Liste und Seitenfenster ohne Marke. */
describe('OpenItemStateBadges', () => {
  it('überfällig und teilweise bezahlt: nur „überfällig“ — „teilweise“ steckt in „Davon offen“', () => {
    render(<OpenItemStateBadges word="partlyPaid" overdue draftSettlement={false} />, { wrapper });
    expect(screen.getByText(messages.finance.openItems.overdue)).toBeTruthy();
    expect(screen.queryByText(messages.finance.openItems.state.partlyPaid)).toBeNull();
  });

  it('teilweise bezahlt, nicht überfällig: die Marke des Zustands', () => {
    render(<OpenItemStateBadges word="partlyPaid" overdue={false} draftSettlement={false} />, { wrapper });
    expect(screen.getByText(messages.finance.openItems.state.partlyPaid)).toBeTruthy();
  });

  it('„offen“ trägt keine Marke, auch im Seitenfenster', () => {
    const { container } = render(<OpenItemStateBadges word="open" overdue={false} draftSettlement={false} />, { wrapper });
    expect(container.textContent).toBe('');
  });
});
