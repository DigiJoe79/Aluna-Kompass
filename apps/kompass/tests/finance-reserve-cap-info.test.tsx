// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/reserves/actions', () => ({}));
const { CapDerivation } = await import('@/app/(shell)/finance/reserves/reserve-table');

afterEach(cleanup);

/** Runde 3, 123 (Joe): Auf der Seite die kurze Zeile, die Rechnung mit den Zahlen des Jahres hinter einem Infoknopf. */
describe('CapDerivation', () => {
  it('zeigt die Näherung und auf Knopfdruck die Rechnung mit den Zahlen', () => {
    const t = createTranslator({ locale: 'de', messages, namespace: 'finance.reserves.cap' });
    const derivation = t('derivation', { assetShare: '1/3', asset: '3.000,00 €', otherShare: 10, other: '12.000,00 €' });
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <CapDerivation year="2026" derivation={derivation} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Näherung, den genauen Wert nennt Ihre Steuerberatung.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Rechnung zum Höchstbetrag 2026' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByText(/1\/3 des Überschusses/) as HTMLElement).hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const text = screen.getByText(/1\/3 des Überschusses/) as HTMLElement;
    expect(text.hidden).toBe(false);
    expect(text.textContent).toContain('3.000,00 €');
    expect(text.textContent).toContain('10 % der übrigen');
    expect(text.textContent).toContain('12.000,00 €');
  });
});
