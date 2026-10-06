// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportButton } from '@/app/(shell)/admin/audit/export-button';
import { CreateContactDialog } from '@/app/(shell)/contacts/contact-form';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/actions', () => ({ createContactAction: vi.fn(), updateContactAction: vi.fn() }));

afterEach(cleanup);

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

/** Primär ist die naheliegende Hauptaktion einer Seite (docs/MUSTER.md, Seitenrahmen). */
describe('Hauptaktion in der Kopfzeile ist primär', () => {
  it('„Als PDF exportieren“ ist primär, auch gesperrt', () => {
    render(<ExportButton enabled />, { wrapper: Intl });
    expect(screen.getByRole('link', { name: /exportieren/ }).className).toContain('bg-brand');
    cleanup();
    render(<ExportButton enabled={false} />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: /exportieren/ }).className).toContain('bg-brand');
  });

  it('„Kontakt bearbeiten“, einzige Aktion der Detailseite, ist primär', () => {
    const contact = { id: 'c1', kind: 'person' as const, salutation: null, firstName: 'A', lastName: 'B', name: null, legalForm: null, addressExtra: null, street: null, postalCode: null, city: null, country: null, notes: null, updatedAt: '2026-01-01T00:00:00Z' };
    render(<CreateContactDialog contact={contact} />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: /bearbeiten/ }).className).toContain('bg-brand');
  });
});
