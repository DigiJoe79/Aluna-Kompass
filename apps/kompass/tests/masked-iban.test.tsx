// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { AccountCard } from '@/components/finance/account-card';
import { ibanLastFour } from '@/lib/finance/iban-check';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

/** Verdeckte IBAN mit Vorleser-Satz „IBAN endet auf 2051“ (Designer 2026-10-16, Teil 1 Nr. 3). */
describe('verdeckte IBAN', () => {
  it('liest die letzten vier aus offener und verdeckter Form', () => {
    expect(ibanLastFour('DE23 9999 9999 0000 2020 51')).toBe('2051');
    expect(ibanLastFour('DE ·· 2051')).toBe('2051');
  });

  it('die Kontokarte nennt Vorlesern das Ende, sehend bleibt „DE ·· 2051“', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <AccountCard account={{ accountId: 'A', name: 'Girokonto', kind: 'bank', iban: 'DE23999999990000202051', balanceCents: 0, withReviewedCents: 0, lastCount: null, statement: null }} />
      </NextIntlClientProvider>,
    );
    const shown = screen.getByTestId('iban-value');
    expect(shown.textContent).toBe('DE\u00a0··\u00a02051');
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('IBAN endet auf 2051').className).toContain('sr-only');
  });
});
