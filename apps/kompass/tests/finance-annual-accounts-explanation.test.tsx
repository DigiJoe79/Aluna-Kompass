// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const saveAnnualAccountsExplanationAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports/annualAccounts' }));
vi.mock('@/app/(shell)/finance/reports/[key]/annual-accounts/actions', () => ({ saveAnnualAccountsExplanationAction }));
vi.mock('@/components/markdown-preview', () => ({ MarkdownPreview: ({ markdown }: { markdown: string }) => <div data-testid="preview">{markdown}</div> }));
const { ExplanationDialog } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/explanation-dialog');
afterEach(cleanup);
beforeEach(() => saveAnnualAccountsExplanationAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const show = (mode: 'edit' | 'view', text = 'Ein gutes Jahr.', onOpenChange = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <ExplanationDialog open onOpenChange={onOpenChange} fiscalYearId="y25" designation="2025" text={text} updatedAt="2026-02-20T08:00:00.000Z" mode={mode} />
    </NextIntlClientProvider>,
  );
const description = (el: HTMLElement) => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
const SAVE = () => screen.getByRole('button', { name: m('common.save') });

describe('Erläuterung der Jahresrechnung (Designer Frage 1)', () => {
  it('the counter follows the input', () => {
    show('edit');
    const box = within(screen.getByRole('dialog')).getByRole('textbox');
    expect(description(box)).toContain('15');
    fireEvent.change(box, { target: { value: 'Ein sehr gutes Jahr für den Verein.' } });
    expect(description(box)).toContain('35');
    expect(description(box)).toContain('4.000');
  });

  it('saves with the version it opened and closes', async () => {
    saveAnnualAccountsExplanationAction.mockResolvedValue({ status: 'success' });
    const onOpenChange = vi.fn();
    show('edit', 'Ein gutes Jahr.', onOpenChange);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Neu.' } });
    fireEvent.click(SAVE());
    await waitFor(() => expect(saveAnnualAccountsExplanationAction).toHaveBeenCalledWith({ fiscalYearId: 'y25', text: 'Neu.', expectedVersion: '2026-02-20T08:00:00.000Z' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a field error of the service stands at the field, the dialog stays open', async () => {
    saveAnnualAccountsExplanationAction.mockResolvedValue({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { text: 'Höchstens 4.000 Zeichen.' } });
    const onOpenChange = vi.fn();
    show('edit', 'Ein gutes Jahr.', onOpenChange);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(4001) } });
    fireEvent.click(SAVE());
    await waitFor(() => expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true'));
    expect(description(screen.getByRole('textbox'))).toContain('Höchstens 4.000 Zeichen.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a stale version offers to load the new state (Review Focus 4)', async () => {
    saveAnnualAccountsExplanationAction.mockResolvedValue({ status: 'error', code: 'staleVersion', message: m('common.conflict.textPlain'), fieldErrors: {} });
    show('edit');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Anders.' } });
    fireEvent.click(SAVE());
    expect(await screen.findByRole('button', { name: m('common.conflict.reload') })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('view has no text field and no save', () => {
    show('view');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: m('common.save') })).toBeNull();
    expect(screen.getByTestId('preview').textContent).toBe('Ein gutes Jahr.');
  });
});
