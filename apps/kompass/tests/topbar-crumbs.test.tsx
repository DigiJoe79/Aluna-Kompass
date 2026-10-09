// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from '@/components/shell/topbar';
import type { Crumb } from '@/lib/navigation';
import messages from '../messages/de.json';

// Das Nutzermenü liest Einstellungen aus dem Profil; für die Brotkrume spielt es keine Rolle.
vi.mock('@/components/shell/user-menu', () => ({ UserMenu: () => null }));
afterEach(cleanup);

function renderTopbar(crumbs: Crumb[]) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <Topbar organization="V" logoUrl={null} crumbs={crumbs} user={{ name: 'A B' }} build="x" version="y" drawer={false} onOpenDrawer={() => {}} onSearch={() => {}} onHelp={() => {}} />
    </NextIntlClientProvider>,
  );
}

/** Spec Seitenkopf § 2.1: Die Brotkrume ist Navigation, keine Überschrift; sie endet bei der Liste. */
describe('Brotkrume der Kopfleiste', () => {
  it('ist nav mit Liste; auf der Detailseite ist die Liste ein Link ohne aria-current', () => {
    renderTopbar([
      { label: 'Tiere', current: false },
      { label: 'Hunde', href: '/animals', current: false },
    ]);
    const nav = screen.getByRole('navigation', { name: 'Brotkrume' });
    expect(within(nav).getByRole('list')).toBeTruthy();
    expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
    expect(within(nav).getByRole('link', { name: 'Hunde' }).getAttribute('href')).toBe('/animals');
    expect(nav.querySelector('[aria-current]')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('auf der Listenseite trägt das letzte Segment aria-current und ist kein Link', () => {
    renderTopbar([
      { label: 'Tiere', current: false },
      { label: 'Hunde', href: '/animals', current: true },
    ]);
    const nav = screen.getByRole('navigation', { name: 'Brotkrume' });
    expect(within(nav).queryByRole('link', { name: 'Hunde' })).toBeNull();
    expect(within(nav).getByText('Hunde').getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByText('Tiere').getAttribute('aria-current')).toBeNull();
  });
});
