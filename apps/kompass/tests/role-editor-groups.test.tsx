// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { RoleEditor } from '@/app/(shell)/admin/roles/role-editor';

vi.mock('@/app/(shell)/admin/roles/actions', () => ({ createRoleAction: vi.fn(), saveRoleAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

/**
 * Rolleneditor nach Runde 3 (Designer Frage 3, 158): Gruppen klappen. Beim Öffnen einer Rolle sind teilweise gesetzte
 * Gruppen offen, ganz gesetzte und leere zu; ein Haken klappt nichts. Im Kopf „1 von 2“, oben „Alle aufklappen“ ↔
 * „Alle zuklappen“, dazu „Trägt diese Rolle: …“ bzw. „niemand“.
 */
const groups = [
  { key: 'core.admin', labelKey: 'permissions.groups.core.admin', keys: ['users.manage', 'roles.manage'] },
  { key: 'core.accountability', labelKey: 'permissions.groups.core.accountability', keys: ['audit.view', 'retention.view'] },
  { key: 'core.followUps', labelKey: 'permissions.groups.core.followUps', keys: ['followUps.view', 'followUps.manage'] },
];
const all = groups.flatMap((g) => g.keys);
const role = (id: string, name: string, permissionKeys: string[], userCount = 0) => ({ id, name, description: '', isProtected: false, permissionKeys, userCount });
const show = (holders: Record<string, string[]> = {}) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RoleEditor
        roles={[role('R1', 'Vorstand', ['users.manage', 'roles.manage', 'audit.view'], 1), role('R2', 'Kasse', [])] as never}
        groups={groups}
        allPermissionKeys={all}
        grantablePermissionKeys={all}
        holders={holders}
      />
    </NextIntlClientProvider>,
  );
const group = (label: string) => screen.getByRole('button', { name: new RegExp(label) });

describe('Rolleneditor: Gruppen zuklappbar (158)', () => {
  it('beim Öffnen: teilweise gesetzt offen, ganz gesetzt und leer zu; Kopf „1 von 2“', () => {
    show();
    expect(group('Verwaltung').getAttribute('aria-expanded')).toBe('false');
    expect(group('Rechenschaft').getAttribute('aria-expanded')).toBe('true');
    expect(group('Wiedervorlagen').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('1 von 2')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: messages.permissions.keys.users.manage.label })).toBeNull();
    expect(screen.getByRole('checkbox', { name: messages.permissions.keys.retention.view.label })).toBeTruthy();
  });

  it('ein Haken klappt nichts, auch wenn die Gruppe damit ganz gesetzt ist', () => {
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: messages.permissions.keys.retention.view.label }));
    expect(group('Rechenschaft').getAttribute('aria-expanded')).toBe('true');
    expect(group('Rechenschaft').textContent).toContain('2 von 2');
  });

  it('„Alle aufklappen“ wird nach dem Klick zu „Alle zuklappen“', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Alle aufklappen' }));
    expect(groups.every((g) => group(messages.permissions.groups.core[g.key.split('.')[1] as 'admin']).getAttribute('aria-expanded') === 'true')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Alle zuklappen' }));
    expect(group('Rechenschaft').getAttribute('aria-expanded')).toBe('false');
  });

  it('„Trägt diese Rolle“ nennt die Personen, sonst „niemand“', () => {
    show({ R1: ['Anna Berger'] });
    expect(screen.getByText(/Trägt diese Rolle/).parentElement!.textContent).toContain('Anna Berger');
    fireEvent.click(within(screen.getByRole('list', { name: messages.roles.listAria })).getByText('Kasse'));
    expect(screen.getByText(/Trägt diese Rolle/).parentElement!.textContent).toContain('niemand');
  });

  it('„Alle“ zeigt bei „1 von 2“ den Teilzustand, keinen Haken (Runde 4, 158)', () => {
    show();
    const head = screen.getByRole('checkbox', { name: /Rechenschaft/ });
    expect(head.getAttribute('aria-checked')).toBe('mixed');
    expect(head.querySelector('svg.lucide-minus')).toBeTruthy();
    expect(head.querySelector('svg.lucide-check')).toBeNull();
  });
});
