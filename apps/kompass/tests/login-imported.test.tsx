// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/login/actions', () => ({ loginAction: vi.fn() }));

const { LoginForm } = await import('@/app/login/login-form');

afterEach(cleanup);
beforeEach(() => vi.mocked(toast.success).mockClear());

const show = (imported: boolean) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <LoginForm imported={imported} />
    </NextIntlClientProvider>,
  );

describe('Anmeldung nach dem Import', () => {
  // Ein Hinweis, der erst nach einer Handlung erscheint, braucht eine Ansage; der Toast sagt das Ergebnis an,
  // der Kasten trägt die Details ohne Rolle (Designer 2026-10-08).
  it('sagt das Ergebnis einmal per Toast an, der Kasten trägt die Details', async () => {
    show(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(messages.auth.login.importedTitle, { id: 'backup-imported' });
    expect(screen.getByText(messages.auth.login.importedText)).toBeTruthy();
  });

  it('ohne Import keine Ansage', async () => {
    show(false);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
