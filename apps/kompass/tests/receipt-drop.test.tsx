// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { ReceiptDrop } from '@/components/finance/receipt-drop';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

describe('ReceiptDrop', () => {
  it('verbindet die Fehlermeldung mit dem Auswahlknopf, sobald eine da ist (K10 § 4.5)', () => {
    render(<ReceiptDrop onFiles={() => {}} />, { wrapper });
    const pick = screen.getByRole('button');
    expect(pick.getAttribute('aria-describedby')).toBeNull();
    const input = screen.getByTestId('voucher-file-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'bild.txt', { type: 'text/plain' })] } });
    const alert = screen.getByRole('alert');
    expect(alert.id).not.toBe('');
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(alert.id);
  });
});
