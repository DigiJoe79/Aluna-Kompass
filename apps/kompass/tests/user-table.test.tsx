// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ListedUser } from '@kompass/core';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/admin/users', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/admin/users/actions', () => ({
  resetStartPasswordAction: vi.fn(),
  setUserActiveAction: vi.fn(),
  setUserRolesAction: vi.fn(),
  linkUserAction: vi.fn(),
  unlinkUserAction: vi.fn(),
}));
vi.mock('@/components/contact-picker', () => ({ ContactPicker: () => <span>Kontaktwahl</span> }));
const { UserTable } = await import('@/app/(shell)/admin/users/user-table');

afterEach(cleanup);

const user = (id: string, name: string): ListedUser =>
  ({ id, name, email: `${id}@example.org`, roles: [], isActive: true, status: 'active', lastLoginAt: null, controllable: true }) as unknown as ListedUser;

const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <UserTable
        users={[user('u1', 'Mira Klein'), user('u2', 'Peter Lang')]}
        roles={[]}
        contactLinks={{
          u1: { linked: false, linkedName: null, linkedHref: null, controls: { canLink: true, canUnlink: false, reason: 'ownOnce' } },
          u2: { linked: true, linkedName: 'Peter Lang', linkedHref: '/contacts/c2', controls: { canLink: false, canUnlink: true, reason: null } },
        }}
      />
    </NextIntlClientProvider>,
  );

/** Runde 3, 155: Verknüpfen und Lösen im Zeilenmenü; die Spalte zeigt den Namen oder „—“. */
describe('UserTable, Spalte Kontakt', () => {
  it('zeigt den Namen bzw. „—“ und keinen Knopf in der Zeile', () => {
    show();
    const mira = screen.getByRole('row', { name: /Mira Klein/ });
    expect(within(mira).queryByRole('button', { name: 'Verknüpfen' })).toBeNull();
    expect(mira.textContent).not.toContain('nicht verknüpft');
    const peter = screen.getByRole('row', { name: /Peter Lang/ });
    expect(within(peter).getByRole('link', { name: 'Peter Lang' }).getAttribute('href')).toBe('/contacts/c2');
    expect(within(peter).queryByRole('button', { name: 'Lösen' })).toBeNull();
  });

  it('„Mit Kontakt verknüpfen …“ öffnet den Dialog mit dem Satz zur eigenen Verknüpfung, „Verknüpfung lösen“ steht beim Verknüpften', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Peter Lang' }));
    expect(await screen.findByRole('menuitem', { name: 'Verknüpfung lösen' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    cleanup();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Mira Klein' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mit Kontakt verknüpfen …' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Das geht einmal');
  });

  it('die Rückfrage zum Deaktivieren nennt den Namen im Titel und kein Pronomen (185)', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Mira Klein' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deaktivieren' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Mira Klein deaktivieren?' })).toBeTruthy();
    expect(dialog.textContent).toContain('Bereits protokollierte Vorgänge bleiben erhalten.');
    expect(dialog.textContent).not.toMatch(/\bihm\b|\bihr\b/);
  });
});
