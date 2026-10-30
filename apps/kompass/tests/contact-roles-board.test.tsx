// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const addContactRoleAction = vi.fn();
const updateContactRoleAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/contacts/actions', () => ({ addContactRoleAction, updateContactRoleAction, endContactRoleAction: vi.fn() }));
const { RolesPanel } = await import('@/app/(shell)/contacts/[id]/roles-panel');
afterEach(cleanup);
beforeEach(() => {
  addContactRoleAction.mockReset();
  updateContactRoleAction.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const OFFICE = () => m('contacts.roles.office');
const REPRESENTS = () => m('contacts.roles.represents');
const defs = [{ key: 'donor', retention: 'p10y' }, { key: 'board-member', retention: 'p10y', representation: true as const }];
type Roles = React.ComponentProps<typeof RolesPanel>['roles'];
const show = (roles: Roles = [], roleDefinitions: React.ComponentProps<typeof RolesPanel>['roleDefinitions'] = defs) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RolesPanel contactId="c1" contactName="Thomas Wendt" roles={roles} roleDefinitions={roleDefinitions} canManage today="2026-10-28" />
    </NextIntlClientProvider>,
  );

describe('Rolle Vorstandsmitglied mit Amt und Vertretung (Abnahme 14)', () => {
  it('the fields appear only for a role that may represent; saving sends them', async () => {
    addContactRoleAction.mockResolvedValue({ status: 'success' });
    show();
    fireEvent.click(screen.getByRole('button', { name: m('contacts.roles.add') }));
    const dialog = screen.getByRole('dialog');
    const role = within(dialog).getByLabelText(new RegExp(m('contacts.roles.field')));
    fireEvent.change(role, { target: { value: 'donor' } });
    expect(within(dialog).queryByLabelText(OFFICE())).toBeNull();
    expect(within(dialog).queryByRole('switch')).toBeNull();
    fireEvent.change(role, { target: { value: 'board-member' } });
    fireEvent.change(within(dialog).getByLabelText(OFFICE()), { target: { value: 'Vorsitzender' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: REPRESENTS() }));
    fireEvent.click(within(dialog).getByRole('button', { name: m('contacts.roles.submit') }));
    await waitFor(() => expect(addContactRoleAction).toHaveBeenCalledWith('c1', 'board-member', '2026-10-28', { note: 'Vorsitzender', representsAssociation: true }));
  });

  it('other roles are added without extra fields', async () => {
    addContactRoleAction.mockResolvedValue({ status: 'success' });
    show();
    fireEvent.click(screen.getByRole('button', { name: m('contacts.roles.add') }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(m('contacts.roles.field'))), { target: { value: 'donor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('contacts.roles.submit') }));
    await waitFor(() => expect(addContactRoleAction).toHaveBeenCalledWith('c1', 'donor', '2026-10-28', undefined));
  });

  it('“Bearbeiten …” only for running roles that may represent; it updates and shows the error at the switch', async () => {
    updateContactRoleAction.mockResolvedValue({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { representsAssociation: 'Diese Rolle kann den Verein nicht vertreten.' } });
    show([
      { id: 'r1', role: 'board-member', since: '2024-04-01', until: null, note: 'Vorsitzender', representsAssociation: true },
      { id: 'r2', role: 'board-member', since: '2020-01-01', until: '2023-12-31', note: null, representsAssociation: false },
      { id: 'r3', role: 'donor', since: '2024-01-01', until: null, note: null, representsAssociation: false },
    ]);
    const edits = screen.getAllByRole('button', { name: m('contacts.roles.edit') });
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    const office = within(dialog).getByLabelText(OFFICE()) as HTMLInputElement;
    expect(office.value).toBe('Vorsitzender');
    fireEvent.change(office, { target: { value: 'Stellvertretender Vorsitzender' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(updateContactRoleAction).toHaveBeenCalledWith('c1', 'r1', { note: 'Stellvertretender Vorsitzender', representsAssociation: true }));
    const toggle = within(dialog).getByRole('switch', { name: REPRESENTS() });
    await waitFor(() => expect(toggle.getAttribute('aria-invalid')).toBe('true'));
  });

  it('„Rolle hinzufügen“ beginnt leer, auch nach „Bearbeiten …“ einer anderen Rolle (Review U1)', () => {
    show([{ id: 'r1', role: 'board-member', since: '2024-04-01', until: null, note: 'Kassenwart', representsAssociation: true }]);
    const cancel = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: m('common.cancel') }));
    fireEvent.click(screen.getByRole('button', { name: m('contacts.roles.add') }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(new RegExp(m('contacts.roles.field'))), { target: { value: 'board-member' } });
    cancel();
    fireEvent.click(screen.getByRole('button', { name: m('contacts.roles.edit') }));
    cancel();
    fireEvent.click(screen.getByRole('button', { name: m('contacts.roles.add') }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(OFFICE()) as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByRole('switch', { name: REPRESENTS() }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('a role another module manages (V-1)', () => {
  it('the managed role is not choosable; a row it carries has no actions, a row from before it keeps „Beenden“ and „Bearbeiten …“', () => {
    show(
      [
        { id: 'r1', role: 'board-member', since: '2026-03-20', until: null, note: null, representsAssociation: true, managed: true },
        { id: 'r2', role: 'board-member', since: '2023-01-01', until: null, note: 'Vorsitz', representsAssociation: true, managed: false },
      ],
      [{ key: 'donor', retention: 'p10y' }, { key: 'board-member', retention: 'p10y', representation: true, managed: true }],
    );
    expect(screen.getAllByRole('button', { name: m('contacts.roles.end') })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: m('contacts.roles.edit') })).toHaveLength(1);
  });
});
