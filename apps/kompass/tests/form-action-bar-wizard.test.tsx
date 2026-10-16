// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FormActionBar } from '@/components/forms/form-action-bar';

/** E3: Fuß eines Assistenten (`variant="wizard"`) — Zurück links, „Schritt n von m“ statt Zähler, Primärknopf rechts. */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);
afterEach(cleanup);

describe('FormActionBar variant="wizard"', () => {
  it('„Schritt 2 von 4“ statt Zähler, Zurück ruft zurück, Weiter ruft onSave, kein Verwerfen', () => {
    const back = vi.fn();
    const next = vi.fn();
    render(
      <FormActionBar variant="wizard" wizard={{ step: 2, total: 4, onBack: back }} onSave={next} saveLabel="Weiter" back={{ href: '/finance/imports', label: 'Auszüge' }} />,
      { wrapper },
    );
    expect(screen.getByText('Schritt 2 von 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Zurück/ }));
    expect(back).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(next).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Abbrechen' }).getAttribute('href')).toBe('/finance/imports');
  });

  it('im ersten Schritt ist Zurück unsichtbar, damit nichts springt', () => {
    render(<FormActionBar variant="wizard" wizard={{ step: 1, total: 4, onBack: () => {} }} onSave={() => {}} saveLabel="Weiter" />, { wrapper });
    const back = screen.getByText(/Zurück/, { selector: 'button' });
    expect(back.className).toContain('invisible');
    expect(back.getAttribute('aria-hidden')).toBe('true');
  });
});
