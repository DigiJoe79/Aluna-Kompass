// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormErrorSummary } from '@/components/forms/form-error-summary';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const box = () => screen.getByRole('alert');
const lines = () => within(box()).getAllByRole('listitem').map((li) => li.textContent);

/**
 * Befund 6 (0.2.4): Beim 13. Foto stand oben nur „Ein Feld braucht noch eine
 * Angabe.“ — nichts fehlte, es war eines zu viel, und das Feld selbst zeigte
 * nichts. Die Box nennt deshalb jedes betroffene Feld mit seiner Meldung.
 */
describe('FormErrorSummary', () => {
  it('names each field with its message, under a neutral heading', () => {
    render(<FormErrorSummary errors={{ photos: 'Höchstens 12 Einträge.' }} labels={{ photos: 'Fotos' }} />, { wrapper: Intl });
    expect(box().textContent).toContain('Bitte prüfen Sie ein Feld:');
    expect(box().textContent).not.toContain('Angabe');
    expect(lines()).toEqual(['Fotos: Höchstens 12 Einträge.']);
  });

  it('lists a language field once, not once per language', () => {
    render(
      <FormErrorSummary
        errors={{ 'summary.de': 'Pflichtfeld.', 'summary.en': 'Pflichtfeld.', name: 'Zu lang.' }}
        labels={{ summary: 'Kurzbeschreibung', name: 'Name' }}
      />,
      { wrapper: Intl }
    );
    expect(box().textContent).toContain('Bitte prüfen Sie 2 Felder:');
    expect(lines()).toEqual(['Kurzbeschreibung: Pflichtfeld.', 'Name: Zu lang.']);
  });

  it('keeps different messages of one language field', () => {
    render(<FormErrorSummary errors={{ 'body.de': 'Pflichtfeld.', 'body.en': 'Zu lang.' }} labels={{ body: 'Text' }} />, { wrapper: Intl });
    expect(lines()).toEqual(['Text: Pflichtfeld. Zu lang.']);
  });

  it('groups by the full key when the form labels a dotted key itself (settings)', () => {
    render(
      <FormErrorSummary
        errors={{ 'organization.name': 'Pflichtfeld.', 'organization.city': 'Zu lang.' }}
        labels={{ 'organization.name': 'Vereinsname', 'organization.city': 'Ort' }}
      />,
      { wrapper: Intl }
    );
    expect(lines()).toEqual(['Vereinsname: Pflichtfeld.', 'Ort: Zu lang.']);
  });

  it('never shows a technical key: without a label it says „Ein Feld“', () => {
    render(<FormErrorSummary errors={{ 'externalLinks.0.url': 'Ungültige Adresse.' }} labels={{}} />, { wrapper: Intl });
    expect(lines()).toEqual(['Ein Feld: Ungültige Adresse.']);
    expect(box().textContent).not.toContain('externalLinks');
  });

  it('renders nothing without errors', () => {
    const { container } = render(<FormErrorSummary errors={{}} labels={{}} />, { wrapper: Intl });
    expect(container.textContent).toBe('');
  });
});

// Runde 3, 188: Bei einem einzigen Feld stand der Fehler zweimal — als Kasten oben und wortgleich am Feld. Der Kasten
// erscheint erst ab zwei Fehlern oder wenn das eine Feld außer Sicht ist (anderer Reiter, weiter unten, kein Feld).
describe('FormErrorSummary: ein Fehler am sichtbaren Feld', () => {
  const place = (rect: Partial<DOMRect>) => {
    const input = document.createElement('input');
    input.id = 'email';
    input.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...rect }) as DOMRect;
    document.body.appendChild(input);
    return () => input.remove();
  };

  it('steht das eine Feld im Blick, gibt es keinen Kasten', () => {
    const remove = place({ top: 100, bottom: 130, width: 200, height: 30 });
    render(<FormErrorSummary errors={{ email: 'Bitte eine E-Mail-Adresse.' }} labels={{ email: 'E-Mail' }} />, { wrapper: Intl });
    expect(screen.queryByRole('alert')).toBeNull();
    remove();
  });

  it('liegt es außer Sicht, steht der Kasten', () => {
    const remove = place({ top: 2000, bottom: 2030, width: 200, height: 30 });
    render(<FormErrorSummary errors={{ email: 'Bitte eine E-Mail-Adresse.' }} labels={{ email: 'E-Mail' }} />, { wrapper: Intl });
    expect(box()).toBeTruthy();
    remove();
  });

  it('ab zwei Fehlern steht der Kasten immer', () => {
    const remove = place({ top: 100, bottom: 130, width: 200, height: 30 });
    render(<FormErrorSummary errors={{ email: 'Bitte eine E-Mail-Adresse.', name: 'Zu lang.' }} labels={{ email: 'E-Mail', name: 'Name' }} />, { wrapper: Intl });
    expect(lines()).toHaveLength(2);
    remove();
  });
});
