// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const loginAction = vi.fn();
vi.mock('@/app/login/actions', () => ({ loginAction: (...args: unknown[]) => loginAction(...args) }));

const { LoginForm } = await import('@/app/login/login-form');

afterEach(cleanup);

const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <LoginForm imported={false} />
    </NextIntlClientProvider>,
  );

describe('Anmeldung nach einem Fehlschlag (01 A2, 01 C30)', () => {
  it('behält die E-Mail, leert nur das Passwort, und kein Feld ist rot', async () => {
    loginAction.mockResolvedValue({ status: 'error', message: messages.auth.login.invalid, fieldErrors: {} });
    const { container } = show();
    const email = screen.getByLabelText(messages.auth.login.email) as HTMLInputElement;
    const password = screen.getByLabelText(messages.auth.login.password) as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'anna@example.org' } });
    fireEvent.change(password, { target: { value: 'falsch-falsch-falsch' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByText(messages.auth.login.invalid)).toBeTruthy());
    expect((screen.getByLabelText(messages.auth.login.email) as HTMLInputElement).value).toBe('anna@example.org');
    expect((screen.getByLabelText(messages.auth.login.password) as HTMLInputElement).value).toBe('');
    // Die Meldung reicht; Rot an zwei Feldern läse sich wie zwei Fehler (01 C30).
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});
