// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/lib/markdown-preview', () => ({ renderMarkdownAction: vi.fn(async () => '') }));
const { LocalizedField } = await import('@/components/forms/localized-field');

afterEach(cleanup);

const ui = (value: { de: string }, onChange?: (v: Record<string, string>) => void) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    <LocalizedField name="name" label="Name" value={value} locales={['de']} onChange={onChange} />
  </NextIntlClientProvider>
);

/**
 * Scheitert ein Speichern am Versionskonflikt, rendert der Server die Seite mit dem neuen Stand. Ein Formular ohne
 * `onChange` hält seine Eingaben selbst — der neue Stand darf sie nicht überschreiben, sonst verliert die Person,
 * was sie getippt hat (die Maske verspricht: „Ihre Eingaben stehen noch in der Maske“).
 */
describe('LocalizedField und ein neuer Stand vom Server', () => {
  it('ohne onChange bleibt die Eingabe stehen', () => {
    const { rerender } = render(ui({ de: 'Alt' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Meine Eingabe' } });
    rerender(ui({ de: 'Von anderswo' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Meine Eingabe');
  });

  it('mit onChange folgt das Feld seinem Wert', () => {
    const { rerender } = render(ui({ de: 'Alt' }, () => {}));
    rerender(ui({ de: 'Zurückgesetzt' }, () => {}));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Zurückgesetzt');
  });
});
