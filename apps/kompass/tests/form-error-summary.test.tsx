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
