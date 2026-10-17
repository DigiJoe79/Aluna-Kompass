// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelsEditor } from '@/app/(shell)/contacts/[id]/channels-editor';
import { RetentionPanel } from '@/app/(shell)/contacts/[id]/retention-panel';
import { RolesPanel } from '@/app/(shell)/contacts/[id]/roles-panel';
import { CreateContactDialog } from '@/app/(shell)/contacts/contact-form';
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

  it('Rolle hinzufügen: Der Untertitel nennt den Kontakt, nicht den Abschnitt (04 A3)', async () => {
    render(<RolesPanel contactId="C1" contactName="Erika Muster" roles={[]} roleDefinitions={[{ key: 'donor', retention: 'p10y' }]} canManage today="2026-10-17" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Rolle hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Für Erika Muster');
    expect(screen.getByText('Rolle', { selector: 'label' }).parentElement!.textContent).toContain('*');
  });

  it('Kommunikationswege: Untertitel mit Namen, Pflichtstern am Wert, Entfernen als Text (04 A3, 04 B24, 04 B14)', async () => {
    render(<ChannelsEditor contactId="C1" contactName="Erika Muster" channels={[{ id: 'K1', kind: 'email', value: 'a@example.org', label: null, isPrimary: true }]} canManage />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weg hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Für Erika Muster');
    expect(screen.getByText('Wert', { selector: 'label' }).parentElement!.textContent).toContain('*');
  });

  it('Rollen: „Beenden“ ist ein Rahmenknopf, kein grauer Textknopf (04 B13)', () => {
    render(<RolesPanel contactId="C1" contactName="Erika Muster" roles={[{ id: 'R1', role: 'donor', since: '2024-01-01', until: null }]} roleDefinitions={[{ key: 'donor', retention: 'p10y' }]} canManage today="2026-10-17" />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Beenden' }).getAttribute('class')).not.toContain('text-muted-ink');
  });

  it('Rollen: beendete stehen gedämpft unter den laufenden (Runde 3, 039)', () => {
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
    expect(items[1]!.className).toContain('text-muted-ink');
  });

  it('Kommunikationswege: „Entfernen“ in der Kartenliste hat einen Rand — Textknöpfe nur für Abbrechen, Schließen, Verwerfen (Runde 4)', () => {
    render(<ChannelsEditor contactId="C1" contactName="Erika Muster" channels={[{ id: 'K1', kind: 'email', value: 'a@example.org', label: null, isPrimary: true }]} canManage />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Entfernen' }).getAttribute('class')).toContain('border-line-strong');
  });

  it('Land: Hinweis „leer = Vereinsland“ statt Platzhalter „DE“, Anschrift Straße · PLZ · Ort (04 B20, 04 B21)', () => {
    render(<CreateContactDialog open onOpenChange={() => {}} withTrigger={false} />, { wrapper: Intl });
    const country = document.getElementById('country') as HTMLInputElement;
    expect(country.placeholder).toBe('');
    expect(screen.getByText('Leer heißt: Land des Vereins.')).toBeTruthy();
    const order = ['addressExtra', 'street', 'postalCode', 'city', 'country'].map((id) => document.getElementById(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
