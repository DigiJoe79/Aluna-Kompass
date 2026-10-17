// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StartPasswordDialog } from '@/app/(shell)/admin/users/start-password-dialog';
import messages from '../messages/de.json';

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

/** Befund 1 Nr. 3 (0.2.12): „Nutzer … angelegt“ nur beim Anlegen, beim neuen Startpasswort ein eigener Titel. */
describe('StartPasswordDialog', () => {
  const props = { open: true, onClose: () => {}, name: 'Anna Berger', email: 'anna@example.org', startPassword: 'geheim-123' };

  it('nennt beim Anlegen den angelegten Nutzer', () => {
    render(<StartPasswordDialog {...props} kind="created" />, { wrapper });
    expect(screen.getByRole('heading', { name: 'Nutzer „Anna Berger“ angelegt' })).toBeTruthy();
  });

  it('nennt beim neuen Startpasswort das neue Startpasswort', () => {
    render(<StartPasswordDialog {...props} kind="reset" />, { wrapper });
    expect(screen.getByRole('heading', { name: 'Neues Startpasswort für „Anna Berger“' })).toBeTruthy();
    expect(screen.queryByText(/angelegt/)).toBeNull();
  });
});
