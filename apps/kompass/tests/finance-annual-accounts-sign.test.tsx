// @vitest-environment jsdom
import type { AnnualAccountsState } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const signAnnualAccountsAction = vi.fn();
const requestAnnualAccountsSignatureAction = vi.fn();
const attachSignedAnnualAccountsScanAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports/annualAccounts' }));
vi.mock('@/app/(shell)/finance/reports/[key]/annual-accounts/actions', () => ({ saveAnnualAccountsExplanationAction: vi.fn(), signAnnualAccountsAction, requestAnnualAccountsSignatureAction, attachSignedAnnualAccountsScanAction }));
vi.mock('@/components/markdown-preview', () => ({ MarkdownPreview: () => null }));
const { PublicationCard } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/publication-card');
afterEach(cleanup);
beforeEach(() => {
  signAnnualAccountsAction.mockReset();
  requestAnnualAccountsSignatureAction.mockReset();
  attachSignedAnnualAccountsScanAction.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const A = 'finance.reports.annualAccounts';
const thomas = { contactId: 'c-thomas', name: 'Thomas Wendt', office: 'Vorsitzender', roleId: 'r1', userId: 'u-thomas', mailState: 'ready' as const };
const greta = { contactId: 'c-greta', name: 'Greta Sommer', office: 'Stellvertretende Vorsitzende', roleId: 'r2', userId: 'u-greta', mailState: 'noAddress' as const };
const olga = { contactId: 'c-olga', name: 'Olga Ohnekonto', office: null, roleId: 'r3', userId: null, mailState: 'noAccount' as const };
const state = (canSignSelf: boolean): AnnualAccountsState => ({
  fiscalYearId: 'y25',
  designation: '2025',
  finalVersion: { reportId: 'r1', documentId: 'd1', documentNumber: 'JRE-2026-001', finalizedAt: '2026-02-25T10:20:00.000Z', shortHash: '7d3e91ab', corrected: null },
  explanation: { state: 'done', length: 812, updatedAt: '2026-02-20T08:00:00.000Z', locked: true },
  signature: { state: 'open', mutedReason: null, signed: null, request: null, canSignSelf, representatives: [thomas, greta, olga] },
  website: { state: 'muted', mutedReason: 'notSigned', publication: null, previous: null, publishNeeds: 'nothing', blockedCode: null, mayPublish: true, assemblyOn: null },
  doneCount: 1,
});
const show = (st: AnnualAccountsState, me: { userId: string; canFinalize: boolean; canPublish: boolean }) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <PublicationCard state={st} me={me} names={{}} explanation={{ text: 'Ein Jahr.', updatedAt: null }} organizationName="Musterverein e.V." today="2026-02-27" />
    </NextIntlClientProvider>,
  );
const row = () => screen.getByTestId('requirement-signature');
const openMenu = () => fireEvent.click(within(row()).getAllByRole('button').find((b) => b.hasAttribute('aria-haspopup'))!);

describe('Abzeichnen, bitten, Scan (Designer 1d, 1g)', () => {
  it('only representatives see “Abzeichnen …” (Abnahme 3)', () => {
    show(state(false), { userId: 'u-anna', canFinalize: true, canPublish: true });
    expect(within(row()).queryByRole('button', { name: m(`${A}.card.actions.sign`) })).toBeNull();
    expect(within(row()).getByRole('button', { name: m(`${A}.card.actions.request`) })).toBeTruthy();
    cleanup();
    show(state(true), { userId: 'u-thomas', canFinalize: true, canPublish: true });
    expect(within(row()).getByRole('button', { name: m(`${A}.card.actions.sign`) })).toBeTruthy();
    expect(within(row()).queryByRole('button', { name: m(`${A}.card.actions.request`) })).toBeNull();
    openMenu();
    expect(screen.getByRole('menuitem', { name: m(`${A}.card.actions.request`) })).toBeTruthy();
  });

  it('sign dialog has no field and no checkbox (Abnahme 4)', async () => {
    signAnnualAccountsAction.mockResolvedValue({ status: 'success' });
    show(state(true), { userId: 'u-thomas', canFinalize: false, canPublish: false });
    fireEvent.click(within(row()).getByRole('button', { name: m(`${A}.card.actions.sign`) }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(dialog).getByRole('group', { name: new RegExp(`^${m(`${A}.sign.name`)}`) }).textContent).toContain('Thomas Wendt');
    expect(within(dialog).getByRole('group', { name: new RegExp(`^${m(`${A}.sign.office`)}`) }).textContent).toContain('Vorsitzender');
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.sign.submit`) }));
    await waitFor(() => expect(signAnnualAccountsAction).toHaveBeenCalledWith('r1'));
  });

  it('request offers only representatives and warns before assigning (Abnahme 5, Review Focus 3)', async () => {
    show(state(false), { userId: 'u-anna', canFinalize: true, canPublish: true });
    fireEvent.click(within(row()).getByRole('button', { name: m(`${A}.card.actions.request`) }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByRole('combobox', { name: new RegExp(m(`${A}.request.assignee`)) }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['c-thomas', 'c-greta', 'c-olga']);
    expect(select.value).toBe('c-thomas');
    expect(within(dialog).queryByTestId('request-mail-hint')).toBeNull();
    fireEvent.change(select, { target: { value: 'c-greta' } });
    expect(within(dialog).getByTestId('request-mail-hint').textContent).toContain('Greta Sommer');
    fireEvent.change(select, { target: { value: 'c-thomas' } });
    expect(within(dialog).queryByTestId('request-mail-hint')).toBeNull();

    requestAnnualAccountsSignatureAction.mockResolvedValue({ status: 'error', code: 'annualAccountsSignerWithoutAccount', message: m('finance.errors.annualAccountsSignerWithoutAccount.reason'), fieldErrors: {} });
    fireEvent.change(select, { target: { value: 'c-olga' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.request.submit`) }));
    await waitFor(() => expect(requestAnnualAccountsSignatureAction).toHaveBeenCalledWith({ reportId: 'r1', contactId: 'c-olga', dueAt: '2026-03-06', name: 'Olga Ohnekonto' }));
    expect(await within(dialog).findByText(m('finance.errors.annualAccountsSignerWithoutAccount.reason'))).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('scan: without a file the service names the field and the dialog stays open', async () => {
    attachSignedAnnualAccountsScanAction.mockResolvedValue({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { bytes: 'Bitte eine PDF-Datei wählen.' } });
    show(state(false), { userId: 'u-anna', canFinalize: true, canPublish: true });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: m(`${A}.card.actions.scan`) }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: m(`${A}.scan.submit`) }));
    await waitFor(() => expect(attachSignedAnnualAccountsScanAction).toHaveBeenCalled());
    const sent = attachSignedAnnualAccountsScanAction.mock.calls[0]![0] as FormData;
    expect(sent.get('reportId')).toBe('r1');
    expect(sent.get('contactId')).toBe('c-thomas');
    expect(sent.get('signedOn')).toBe('2026-02-27');
    expect(await within(dialog).findByText('Bitte eine PDF-Datei wählen.')).toBeTruthy();
  });
});
