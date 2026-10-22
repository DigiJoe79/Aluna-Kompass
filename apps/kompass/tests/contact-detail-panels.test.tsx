// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetentionPanel } from '@/app/(shell)/contacts/[id]/retention-panel';
import { RolesPanel } from '@/app/(shell)/contacts/[id]/roles-panel';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/actions', () => ({
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
  setContactChannelsAction: vi.fn(),
  addContactRoleAction: vi.fn(),
  endContactRoleAction: vi.fn(),
}));

afterEach(cleanup);

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

/** Durchsicht 0.2.11, Paket 04 (Kontakt-Detail). */
describe('Kontakt-Detail', () => {
  it('Aufbewahrung: Kopfzeile mit der Frist, die zählt, und dem Grund (04 B10)', () => {
    render(
      <RetentionPanel
        holds={[
          { entity: 'contactRole', id: 'R1', label: 'Rolle', until: '2030-12-31' },
          { entity: 'contact', id: 'C1', label: 'Grundfrist', until: '2028-01-31' },
        ]}
        roleKeysById={{ R1: 'donor' }}
      />,
      { wrapper: Intl },
    );
    expect(screen.getByTestId('retention-summary').textContent).toBe('Gehalten bis 31.12.2030, wegen Rolle Spender');
  });

  it('Aufbewahrung: Ein dauerhafter Halter gewinnt (04 B10)', () => {
    render(
      <RetentionPanel
        holds={[
          { entity: 'contact', id: 'C1', label: 'Grundfrist', until: '2028-01-31' },
          { entity: 'contactUserLink', id: 'L1', label: 'Verknüpfung mit einem Nutzerkonto', until: null },
        ]}
        roleKeysById={{}}
      />,
      { wrapper: Intl },
    );
    expect(screen.getByTestId('retention-summary').textContent).toBe('Dauerhaft gehalten, wegen Verknüpfung mit einem Nutzerkonto');
  });

  it('Rollen: beendete stehen unter den laufenden (Runde 3, 039)', () => {
    render(
      <RolesPanel
        contactId="C1"
        contactName="Erika Muster"
        roles={[
          { id: 'R1', role: 'interested', since: '2025-09-01', until: '2026-04-28' },
          { id: 'R2', role: 'donor', since: '2026-10-17', until: null },
        ]}
        roleDefinitions={[{ key: 'donor', retention: 'p10y' }, { key: 'interested', retention: 'p10y' }]}
        canManage
        today="2026-10-17"
      />,
      { wrapper: Intl },
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset.state)).toEqual(['current', 'ended']);
  });
});
