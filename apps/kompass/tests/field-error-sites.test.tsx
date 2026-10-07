// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { AmountField } from '@/components/finance/amount-field';

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const SRC = path.resolve(import.meta.dirname, '../src');

/** K10 Charge 1, § 4.5: Feldfehler nur über `FieldError` (direkt oder über `FormField error`). */
describe('Feldfehler', () => {
  it('AmountField zeigt seinen Fehler über FieldError, verbunden mit dem Feld', () => {
    render(<AmountField name="betrag" value="abc" onChange={() => {}} invalid />, { wrapper });
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('betrag-error');
    expect(alert.className.split(' ')).toEqual(expect.arrayContaining(['mt-1', 'font-semibold', 'text-error']));
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe('betrag-error');
  });

  it.each([
    'app/(shell)/admin/finance/categories-panel.tsx',
    'app/(shell)/admin/finance/accounts-panel.tsx',
    'app/(shell)/finance/work/rule-dialog.tsx',
    'app/(shell)/finance/cash/count-dialog.tsx',
    'components/finance/amount-field.tsx',
    'components/finance/receipt-drop.tsx',
    'app/(shell)/animals/photos-editor.tsx',
  ])('%s hat keinen rohen Feldfehler mehr', (file) => {
    const text = readFileSync(path.join(SRC, file), 'utf8');
    expect(text).not.toMatch(/<p[^>]*text-error/);
  });
});
