// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { RoleEditor } from '@/app/(shell)/admin/roles/role-editor';

const refusal = { status: 'error' as const, message: 'x', fieldErrors: {}, code: 'roleNameTaken', detail: 'Eine Rolle „Vorstand“ gibt es schon. Wählen Sie einen anderen Namen.' };
const createRoleAction = vi.fn(async () => refusal);
const saveRoleAction = vi.fn(async () => refusal);
vi.mock('@/app/(shell)/admin/roles/actions', () => ({ createRoleAction: () => createRoleAction(), saveRoleAction: () => saveRoleAction() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const role = (id: string, name: string) => ({ id, name, description: '', isProtected: false, permissionKeys: [], userCount: 0 });
const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RoleEditor roles={[role('R1', 'Vorstand'), role('R2', 'Kasse')] as never} groups={[]} allPermissionKeys={[]} grantablePermissionKeys={[]} />
    </NextIntlClientProvider>,
  );

/** „Rolle existiert bereits“ am Feld (13 #4, Joe 2026-10-16): am Feld „Rollenname“ und in der Fehlerübersicht, nicht als Ablehnung über der Leiste. */
describe('roleNameTaken am Feld', () => {
  it('beim Anlegen', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: messages.roles.create.button }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(messages.roles.fields.name), { target: { value: 'Vorstand' } });
    fireEvent.click(within(dialog).getByRole('button', { name: messages.roles.create.submit }));
    await waitFor(() => expect(createRoleAction).toHaveBeenCalled());
    const input = await within(dialog).findByLabelText(messages.roles.fields.name);
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getAllByText(/gibt es schon/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('alert', { name: /Nicht möglich/ })).toBeNull();
  });

  it('beim Umbenennen', async () => {
    show();
    fireEvent.change(screen.getByLabelText(messages.roles.fields.name), { target: { value: 'Kasse' } });
    fireEvent.click(screen.getByRole('button', { name: messages.roles.save }));
    await waitFor(() => expect(saveRoleAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(messages.roles.fields.name).getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getAllByText(/gibt es schon/).length).toBeGreaterThan(0);
  });
});

/** 11-1 B25: Die Kopf-Checkbox einer Gruppe sagt sichtbar „Alle“. */
describe('Gruppenkopf im Rolleneditor', () => {
  it('beschriftet die Kopf-Checkbox sichtbar', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <RoleEditor roles={[role('R1', 'Vorstand')] as never} groups={[{ key: 'g', labelKey: 'roles.title', keys: ['users.manage'] }] as never} allPermissionKeys={['users.manage']} grantablePermissionKeys={['users.manage']} />
      </NextIntlClientProvider>,
    );
    const head = screen.getByRole('checkbox', { name: 'Alle: Rollen' });
    expect(head.closest('label')?.textContent).toContain('Alle');
  });
});
