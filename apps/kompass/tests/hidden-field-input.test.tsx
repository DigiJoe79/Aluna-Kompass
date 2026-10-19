// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: async () => ({ contacts: [], more: false }) }));
vi.mock('@/app/(shell)/contacts/contact-form', () => ({ CreateContactDialog: () => null }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const anna: PickedContact = { id: 'A', name: 'Anna Beispiel' } as PickedContact;
const bert: PickedContact = { id: 'B', name: 'Bert Beispiel' } as PickedContact;

/**
 * Versteckte Felder melden keine Eingabe. Die Speicherleiste zählt aber nur, was das Formular als `input` hört —
 * ohne das blieb ein getauschter Empfänger im Brief-Entwurf „Nichts geändert“ und wurde nie gespeichert (Joe 2026-10-18).
 */
describe('versteckte Felder melden eine Änderung', () => {
  it('ContactPicker: ein neuer Kontakt löst am Formular `input` aus, der erste Wert nicht', () => {
    const ui = (value: PickedContact | null) => (
      <Intl>
        <form>
          <ContactPicker id="r" name="recipientId" label="Empfänger" value={value} onChange={() => {}} />
        </form>
      </Intl>
    );
    const { container, rerender } = render(ui(anna));
    const seen = vi.fn();
    container.querySelector('form')!.addEventListener('input', seen);
    rerender(ui(anna));
    expect(seen).not.toHaveBeenCalled();
    rerender(ui(bert));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[name="recipientId"]')!.value).toBe('B');
    rerender(ui(null));
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
