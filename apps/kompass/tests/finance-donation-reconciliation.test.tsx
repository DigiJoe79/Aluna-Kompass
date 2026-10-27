// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { DonationReconciliation } from '@kompass/module-finance';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Reconciliation } from '@/app/(shell)/finance/donations/book/reconciliation';

afterEach(cleanup);

/** `formatEuro` setzt ein geschütztes Leerzeichen vor „€“. */
const text = (element: HTMLElement) => (element.textContent ?? '').replace(/\u00a0/g, ' ');

const data = (over: Partial<DonationReconciliation> = {}): DonationReconciliation => ({
  year: 2025,
  donationsCents: 50_000,
  confirmedCents: 46_000,
  differenceCents: 4_000,
  reasons: [{ key: 'addressMissing', count: 1, cents: 4_000, href: '/finance/donations/run?year=2025' }],
  toCorrect: { count: 1, cents: 6_000, withoutAmountCount: 0, href: '/finance/donations?tab=toCorrect' },
  simplifiedReceiptLimitCents: null,
  ...over,
});

const renderIt = (value: DonationReconciliation) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <Reconciliation data={value} />
    </NextIntlClientProvider>,
  );

/**
 * Plan E15 Task 1 (Befund 40, Frage 1): „Zu korrigieren“ gehört nicht zur Summe der Gründe (6f32f6fe). Es steht wie im
 * PDF-Bericht als Satz unter der Tabelle, nicht als Zeile darin.
 */
describe('Reconciliation', () => {
  it('nennt die Bestätigungen zu korrigieren als Satz unter der Tabelle, nicht als Zeile', () => {
    renderIt(data());
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText(/zu korrigieren/i)).toBeNull();
    const sentence = screen.getByTestId('reconciliation-to-correct');
    expect(sentence.tagName).toBe('P');
    expect(text(sentence)).toBe('Davon in Bestätigungen zu korrigieren: 1 Bestätigung, 60,00 €.');
    expect(within(sentence).getByRole('link', { name: 'in Bestätigungen zu korrigieren' }).getAttribute('href')).toBe('/finance/donations?tab=toCorrect');
  });

  it('ohne Gründe keine leere Tabelle, nur der Satz', () => {
    renderIt(data({ differenceCents: 0, confirmedCents: 50_000, reasons: [], toCorrect: { count: 2, cents: 9_000, withoutAmountCount: 1, href: '/x' } }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(text(screen.getByTestId('reconciliation-to-correct'))).toBe('Davon in Bestätigungen zu korrigieren: 2 Bestätigungen, 90,00 €; davon ohne Auswirkung auf den Betrag: 1.');
  });
});
