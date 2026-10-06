// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormField } from '@/components/forms/form-field';
import { Input } from '@/components/ui/input';

afterEach(cleanup);

/**
 * Handoff Konsistenz § 5 / docs/MUSTER.md § E: Jedes Feld läuft über `FormField`. Die Meldung steht am Feld,
 * und das Feld ist mit ihr verbunden (`aria-describedby`), damit Vorleser sie beim Fokus lesen.
 */
describe('FormField', () => {
  it('connects the label to the field', () => {
    render(
      <FormField id="name" label="Name" required>
        <Input id="name" name="name" />
      </FormField>,
    );
    expect(screen.getByLabelText('Name')).toBe(screen.getByRole('textbox'));
  });

  it('shows the message at the field and links the field to it', () => {
    render(
      <FormField id="name" label="Name" error="Pflichtangabe">
        <Input id="name" name="name" />
      </FormField>,
    );
    const field = screen.getByRole('textbox');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const message = screen.getByText('Pflichtangabe');
    expect(field.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('links the hint while there is no error, and keeps the field valid', () => {
    render(
      <FormField id="slug" label="Kennung" hint="Nur Kleinbuchstaben">
        <Input id="slug" name="slug" />
      </FormField>,
    );
    const field = screen.getByRole('textbox');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('Nur Kleinbuchstaben').id);
  });

  it('finds the field below a wrapper and keeps an aria-describedby the caller set', () => {
    render(
      <FormField id="iban" label="IBAN" error="Ungültig">
        <div>
          <Input id="iban" name="iban" aria-describedby="iban-help" />
        </div>
      </FormField>,
    );
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toMatch(/iban-help/);
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toMatch(/iban-error/);
  });

  /**
   * Eine Ablehnung des Servers darf keine Eingabe kosten: Erscheint die Meldung, muss das Feld dasselbe
   * Element bleiben. Gefunden 2026-10-05: Ein Feld ohne Hinweis wurde beim ersten Fehler neu aufgebaut
   * (anderer Baum über `Children.map`) und fiel auf seinen `defaultValue` zurück — beim Anlegen leer.
   */
  it.each([
    ['without a hint', undefined],
    ['with a hint', 'Ein Hinweis'],
  ])('keeps what was typed when an error appears, %s', (_case, hint) => {
    const field = (error?: string) => (
      <FormField id="name" label="Name" hint={hint} error={error}>
        <Input id="name" name="name" defaultValue="" />
      </FormField>
    );
    const { rerender } = render(field());
    const before = screen.getByRole('textbox');
    fireEvent.change(before, { target: { value: 'mühsam getippt' } });
    rerender(field('Höchstens 80 Zeichen.'));
    expect(screen.getByRole('textbox')).toBe(before);
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'mühsam getippt');
    rerender(field());
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'mühsam getippt');
  });
});
