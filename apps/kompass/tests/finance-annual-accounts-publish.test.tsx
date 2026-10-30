// @vitest-environment jsdom
import type { AnnualAccountsState } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const publishAnnualAccountsAction = vi.fn();
const withdrawAnnualAccountsAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports/annualAccounts' }));
vi.mock('@/app/(shell)/finance/reports/[key]/annual-accounts/actions', () => ({ saveAnnualAccountsExplanationAction: vi.fn(), signAnnualAccountsAction: vi.fn(), requestAnnualAccountsSignatureAction: vi.fn(), attachSignedAnnualAccountsScanAction: vi.fn(), publishAnnualAccountsAction, withdrawAnnualAccountsAction }));
vi.mock('@/components/markdown-preview', () => ({ MarkdownPreview: () => null }));
const { PublicationCard } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/publication-card');
afterEach(cleanup);
beforeEach(() => {
  publishAnnualAccountsAction.mockReset();
  withdrawAnnualAccountsAction.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const A = 'finance.reports.annualAccounts';
const signed = { reportId: 'r1', contactId: 'c-thomas', name: 'Thomas Wendt', office: 'Vorsitzender', signedOn: '2026-02-27', via: 'account' as const, documentId: 'd2', documentNumber: 'JRE-2026-001-A', scanDocumentId: null, scanDocumentNumber: null };
const publication = { id: 'p1', reportId: 'r1', fiscalYearId: 'y25', publishedAt: '2026-03-15T09:00:00.000Z', earlyReason: null, corrected: false, replacesFinalizedAt: null, webVersionOn: null, withdrawnAt: null, withdrawnCause: null, withdrawnLiveSince: null, liveSince: '2026-03-16T08:00:00.000Z' };
const state = (website: Partial<AnnualAccountsState['website']>): AnnualAccountsState => ({
  fiscalYearId: 'y25',
  designation: '2025',
  finalVersion: { reportId: 'r1', documentId: 'd1', documentNumber: 'JRE-2026-001', finalizedAt: '2026-02-25T10:20:00.000Z', shortHash: '7d3e91ab', corrected: null },
  explanation: { state: 'done', length: 812, updatedAt: null, locked: true },
  signature: { state: 'done', mutedReason: null, signed, request: null, canSignSelf: false, representatives: [] },
  website: { state: 'open', mutedReason: null, publication: null, previous: null, publishNeeds: 'nothing', blockedCode: null, mayPublish: true, assemblyOn: '2026-03-14', ...website },
  doneCount: 2,
});
const show = (st: AnnualAccountsState) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <PublicationCard state={st} me={{ userId: 'u-anna', canFinalize: true, canPublish: true }} names={{}} explanation={{ text: '', updatedAt: null }} organizationName="Musterverein e.V." today="2026-03-15" />
    </NextIntlClientProvider>,
  );
const PUBLISH = () => within(screen.getByTestId('requirement-website')).getByRole('button', { name: m(`${A}.card.actions.publish`) });
const dlg = () => screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');

describe('Auf der Webseite publizieren (Abnahme 6)', () => {
  it('after the assembly it is one click without a dialog; a second click while running does nothing', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    publishAnnualAccountsAction.mockReturnValue(new Promise((r) => (resolve = r)));
    show(state({ publishNeeds: 'nothing' }));
    fireEvent.click(PUBLISH());
    expect(dlg()).toBeNull();
    await waitFor(() => expect(publishAnnualAccountsAction).toHaveBeenCalledWith({ reportId: 'r1' }));
    fireEvent.click(PUBLISH());
    expect(publishAnnualAccountsAction).toHaveBeenCalledTimes(1);
    resolve({ status: 'success' });
  });

  it('a refusal stands above the card', async () => {
    publishAnnualAccountsAction.mockResolvedValue({ status: 'error', code: 'siteModuleDisabled', message: m('finance.errors.siteModuleDisabled.reason'), fieldErrors: {} });
    show(state({ publishNeeds: 'nothing' }));
    fireEvent.click(PUBLISH());
    expect(await screen.findByText(m('finance.errors.siteModuleDisabled.reason'))).toBeTruthy();
  });

  it('before the assembly the dialog asks for a reason', async () => {
    publishAnnualAccountsAction.mockResolvedValueOnce({ status: 'error', code: 'annualAccountsEarlyReasonRequired', message: m('finance.errors.annualAccountsEarlyReasonRequired.reason'), fieldErrors: {} });
    show(state({ publishNeeds: 'reason' }));
    fireEvent.click(PUBLISH());
    const dialog = screen.getByRole('dialog');
    const group = within(dialog).getByRole('radiogroup');
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.publish.submit`) }));
    await waitFor(() => expect(publishAnnualAccountsAction).toHaveBeenCalledWith({ reportId: 'r1' }));
    await waitFor(() => expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toContain(m('finance.errors.annualAccountsEarlyReasonRequired.reason')));

    publishAnnualAccountsAction.mockResolvedValueOnce({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { earlyNote: 'Bitte ausfüllen.' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: m(`${A}.publish.reasons.other.label`) }));
    const note = within(dialog).getByRole('textbox');
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.publish.submit`) }));
    await waitFor(() => expect(note.getAttribute('aria-invalid')).toBe('true'));

    publishAnnualAccountsAction.mockResolvedValueOnce({ status: 'success' });
    fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${m(`${A}.publish.reasons.itzDeadline.label`)}`) }));
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.publish.submit`) }));
    await waitFor(() => expect(publishAnnualAccountsAction).toHaveBeenLastCalledWith({ reportId: 'r1', earlyReason: 'itzDeadline' }));
  });

  it('“Von der Webseite nehmen …” asks and withdraws', async () => {
    withdrawAnnualAccountsAction.mockResolvedValue({ status: 'success' });
    show(state({ state: 'done', publication }));
    fireEvent.click(within(screen.getByTestId('requirement-website')).getByRole('button', { name: m(`${A}.card.actions.withdraw`) }));
    const confirm = dlg()!;
    fireEvent.click(within(confirm).getByRole('button', { name: m(`${A}.withdraw.confirm`) }));
    await waitFor(() => expect(withdrawAnnualAccountsAction).toHaveBeenCalledWith('r1'));
  });
});
