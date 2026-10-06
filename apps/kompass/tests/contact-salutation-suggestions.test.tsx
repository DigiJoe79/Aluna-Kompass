// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('Anrede-Vorschläge im Kontaktformular', () => {
  it('schlagen Frau, Herr und Familie aus den Übersetzungen vor — „Dr.“ ist ein Grad, keine Anrede', () => {
    render(<CreateContactDialog open onOpenChange={() => {}} withTrigger={false} />, { wrapper: Intl });
    const options = [...document.querySelectorAll('#salutations option')].map((o) => o.getAttribute('value'));
    expect(options).toEqual(['Frau', 'Herr', 'Familie']);
    expect(options).not.toContain('Dr.');
  });
});
