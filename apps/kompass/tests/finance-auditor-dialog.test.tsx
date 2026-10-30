// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ saveAuditorAction: vi.fn(), previewAuditorAction: vi.fn(), uploadConfidentialityAction: vi.fn(), endAuditorAccessAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => ({ items: [], more: false })) }));
const { AuditorDialog } = await import('@/app/(shell)/finance/audit/auditor-dialog');
const { EndAccessDialog } = await import('@/app/(shell)/finance/audit/end-access-dialog');
afterEach(cleanup);
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockReset());
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const year = { id: 'y25', designation: '2025' };
const existing = { id: 'a1', version: 'v1', contact: { id: 'c1', name: 'Klara Prüf' }, mode: 'kompass' as const, confidential: false, confidentialityDocument: null, electedOn: '2025-04-12', minutesDocument: null };
const access = (over: Record<string, unknown> = {}) => ({ userId: 'u1', userActive: true, hasRole: true, lastLoginAt: null, endedAt: null, roleMissingOrigin: false, ...over });
const preview = (over: Record<string, unknown> = {}, involved: string[] = []) => ({ status: 'success', data: { access: access(over), independence: { boardRole: null, involvedEntryIds: involved }, userName: 'k.pruef' } });

describe('AuditorDialog (Board 12b)', () => {
  it('new: required contact, „Eintragen“, uploading the declaration only after saving', () => {
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={null} canCreateContact />);
    expect(screen.getByRole('heading', { name: m('finance.audit.auditorDialog.titleNew').replace('{year}', '2025') })).toBeTruthy();
    expect(screen.getByRole('button', { name: m('finance.audit.auditorDialog.saveNew') })).toBeTruthy();
    expect(actions.previewAuditorAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: m('finance.audit.auditorDialog.confidential') }));
    expect(screen.getByText(m('finance.audit.auditorDialog.declarationLater'))).toBeTruthy();
  });

  it('edit: checks access for „in Kompass“ at once and says the result; on paper no access check', async () => {
    actions.previewAuditorAction.mockResolvedValue(preview({ hasRole: false }, ['e1', 'e2']));
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={existing} canCreateContact={false} />);
    await waitFor(() => expect(actions.previewAuditorAction).toHaveBeenCalledWith({ fiscalYearId: 'y25', contactId: 'c1', mode: 'kompass' }));
    expect(await screen.findByText(m('finance.audit.auditors.access.noRole'))).toBeTruthy();
    // Die Hinweise zur Unabhängigkeit stehen als Text unter dem Feld.
    expect(screen.getByTestId('auditor-independence').textContent).toContain('2');
    actions.previewAuditorAction.mockResolvedValue(preview());
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.auditors.mode.paper') }));
    await waitFor(() => expect(screen.queryByText(m('finance.audit.auditors.access.noRole'))).toBeNull());
    expect(screen.queryByTestId('auditor-access')).toBeNull();
  });

  it('saves with the version of the entry and puts field errors at the field', async () => {
    actions.previewAuditorAction.mockResolvedValue(preview());
    actions.saveAuditorAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { electedOn: 'Das Datum liegt in der Zukunft.' } });
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={existing} canCreateContact={false} />);
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.auditorDialog.saveEdit') }));
    await waitFor(() =>
      expect(actions.saveAuditorAction).toHaveBeenCalledWith({ id: 'a1', expectedVersion: 'v1', fiscalYearId: 'y25', contactId: 'c1', mode: 'kompass', confidential: false, confidentialityDocumentId: null, electedOn: '2025-04-12', minutesDocumentId: null }),
    );
    expect(await screen.findByText('Das Datum liegt in der Zukunft.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Vorschläge aus Gremien (G7 Task 5, Freigabe Joe 2026-10-29)', () => {
  const candidate = { contactId: 'c9', name: 'Ilse Wahl', electedOn: '2025-03-20', minutesDocument: { id: 'd9', number: 'P-7', subject: 'Protokoll MV', phase: 'issued' as const }, source: { label: 'Beschluss B-2025-004', href: '/governance/resolutions/r1' } };

  it('shows no proposals without candidates and never when editing', () => {
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={null} canCreateContact candidates={[]} />);
    expect(screen.queryByRole('heading', { name: m('finance.audit.auditorDialog.candidates') })).toBeNull();
    cleanup();
    actions.previewAuditorAction.mockResolvedValue(preview());
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={existing} canCreateContact={false} candidates={[candidate]} />);
    expect(screen.queryByRole('radio', { name: /Ilse Wahl/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: m('finance.audit.auditorDialog.candidates') })).toBeNull();
  });

  it('picking a proposal fills contact, date and minutes, each marked with its origin until changed', async () => {
    actions.previewAuditorAction.mockResolvedValue(preview());
    actions.saveAuditorAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: {} });
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={null} canCreateContact candidates={[candidate]} />);
    expect(screen.getByRole('heading', { name: m('finance.audit.auditorDialog.candidates') })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Ilse Wahl/ }));
    const [contact, minutes] = screen.getAllByRole('combobox') as [HTMLInputElement, HTMLInputElement];
    const elected = document.getElementById('auditor-elected') as HTMLInputElement;
    await waitFor(() => expect(contact.value).toContain('Ilse Wahl'));
    expect(elected.value).toBe('2025-03-20');
    expect(minutes.value).toContain('P-7');
    // Je Feld eine Herkunftszeile, die den Beschluss nennt; Modus und Vertraulichkeit wählt man selbst.
    const origin = m('finance.audit.auditorDialog.candidateOrigin').replace('{source}', 'Beschluss B-2025-004');
    expect(screen.getAllByText(origin)).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: m('finance.audit.auditorDialog.confidential') }).getAttribute('aria-checked')).toBe('false');
    // Das Datum ändern nimmt dessen Herkunft weg, die anderen bleiben.
    fireEvent.change(elected, { target: { value: '2025-03-21' } });
    expect(screen.getAllByText(origin)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.auditorDialog.saveNew') }));
    await waitFor(() => expect(actions.saveAuditorAction).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c9', electedOn: '2025-03-21', minutesDocumentId: 'd9', mode: 'kompass', confidential: false })));
  });
});

describe('Erklärung hochladen, dann speichern (Schlussdurchsicht D1b, I3)', () => {
  it('saves against the version the upload left, not the one the dialog opened with', async () => {
    actions.previewAuditorAction.mockResolvedValue(preview());
    actions.uploadConfidentialityAction.mockResolvedValue({ status: 'success', data: { documentId: 'd1', subject: 'erklaerung.pdf', version: 'v2' } });
    actions.saveAuditorAction.mockResolvedValue({ status: 'success' });
    wrap(<AuditorDialog open onOpenChange={() => undefined} year={year} auditor={{ ...existing, confidential: true }} canCreateContact={false} />);
    const input = document.querySelector('[data-testid="auditor-dialog"] input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'erklaerung.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(actions.uploadConfidentialityAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/erklaerung\.pdf/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.auditorDialog.saveEdit') }));
    await waitFor(() => expect(actions.saveAuditorAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', expectedVersion: 'v2', confidentialityDocumentId: 'd1' })));
  });
});

describe('EndAccessDialog (Board 12h)', () => {
  it('names the person and ends the access', async () => {
    actions.endAuditorAccessAction.mockResolvedValue({ status: 'success' });
    const onOpenChange = vi.fn();
    wrap(<EndAccessDialog open onOpenChange={onOpenChange} auditor={{ id: 'a1', name: 'Klara Prüf' }} />);
    expect(screen.getByRole('heading', { name: m('finance.audit.endAccess.title').replace('{name}', 'Klara Prüf') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.endAccess.confirm') }));
    await waitFor(() => expect(actions.endAuditorAccessAction).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
