// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactPicker } from '@/components/contact-picker';
import messages from '../messages/de.json';

const search = vi.hoisted(() => vi.fn(async () => ({ contacts: [], more: false })));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: search }));
vi.mock('@/app/(shell)/contacts/contact-form', () => ({ CreateContactDialog: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Das Schließen der Liste nach dem Verlassen des Felds läuft verzögert. Wird die Komponente in dieser Zeit entfernt
 * (Dialog zu, Test zu Ende), darf der Zeitgeber nicht mehr feuern: In der CI setzte er nach dem Abbau der Testumgebung
 * noch einen Zustand und brach den Lauf mit „window is not defined“ ab (finance-auditor-dialog, 29.10.).
 */
describe('ContactPicker', () => {
  it('räumt den Zeitgeber zum Schließen der Liste beim Entfernen weg', () => {
    vi.useFakeTimers();
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount, container } = render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ContactPicker id="c" name="contactId" label="Kontakt" value={null} onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    fireEvent.blur(container.querySelector('input:not([type="hidden"])')!);
    const index = set.mock.calls.findIndex((call) => call[1] === 120);
    expect(index).toBeGreaterThanOrEqual(0);
    const handle = set.mock.results[index]!.value;
    unmount();
    expect(clear.mock.calls.some((call) => call[0] === handle)).toBe(true);
  });

  it('sucht mit `role` nur unter Kontakten dieser Rolle', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const { container } = render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ContactPicker id="c" name="contactId" label="Kontakt" value={null} onChange={() => {}} kind="person" role="member" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(container.querySelector('input:not([type="hidden"])')!);
    await waitFor(() => expect(search).toHaveBeenCalledWith('', 'person', 'member'));
  });
});
