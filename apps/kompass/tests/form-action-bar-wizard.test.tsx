// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FormActionBar } from '@/components/forms/form-action-bar';

/**
 * E3: Fuß eines Assistenten (`variant="wizard"`) — Zurück links, kein Zähler, Primärknopf rechts. „Schritt n von m“
 * sagt der Schrittbalken (`Steps`) darüber, der Fuß wiederholt es nicht (Runde 3, 083/085).
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);
afterEach(cleanup);

describe('FormActionBar variant="wizard"', () => {
  it('weder Zähler noch „Schritt 2 von 4“, Zurück ruft zurück, Weiter ruft onSave, kein Verwerfen', () => {
    const back = vi.fn();
    const next = vi.fn();
    render(
      <FormActionBar variant="wizard" wizard={{ step: 2, total: 4, onBack: back }} onSave={next} saveLabel="Weiter" back={{ href: '/finance/imports', label: 'Auszüge' }} />,
      { wrapper },
    );
    expect(screen.queryByText('Schritt 2 von 4')).toBeNull();
    expect(screen.queryByText(/Änderung/)).toBeNull();
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

  it('zeigt `note` links neben Zurück, solange sie gesetzt ist (CSV-Assistent Schritt 3, Spec 2026-10-22)', () => {
    render(<FormActionBar variant="wizard" wizard={{ step: 3, total: 5, onBack: () => {} }} onSave={() => {}} saveLabel="Weiter" note="Noch offen: Betrag" />, { wrapper });
    expect(screen.getByText('Noch offen: Betrag')).toBeTruthy();
  });
});
