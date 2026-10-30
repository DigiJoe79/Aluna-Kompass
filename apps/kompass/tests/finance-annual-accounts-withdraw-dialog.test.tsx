// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports/annualAccounts' }));
vi.mock('@/app/(shell)/finance/reports/[key]/annual-accounts/actions', () => ({ withdrawAnnualAccountsAction: vi.fn() }));
const { WithdrawDialog } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/withdraw-dialog');
afterEach(cleanup);

const show = (live: boolean) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <WithdrawDialog open onOpenChange={() => undefined} reportId="r1" designation="2025" live={live} />
    </NextIntlClientProvider>,
  );

/** Abnahme B1, Nachzug 3: Nur bereitgestellt heißt es „Bereitstellung zurücknehmen“, live gewesen „Von der Webseite nehmen“. */
describe('WithdrawDialog', () => {
  it('nur bereitgestellt: Bereitstellung zurücknehmen — Titel, Satz, Knopf', () => {
    show(false);
    const dialog = screen.getByRole('alertdialog');
    expect(screen.getByRole('heading', { name: 'Bereitstellung zurücknehmen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bereitstellung zurücknehmen' })).toBeTruthy();
    expect(dialog.textContent).not.toContain('Von der Webseite');
    expect(dialog.textContent).toContain('2025');
  });

  it('auf der Webseite: Von der Webseite nehmen', () => {
    show(true);
    expect(screen.getByRole('heading', { name: 'Von der Webseite nehmen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Von der Webseite nehmen' })).toBeTruthy();
  });
});
