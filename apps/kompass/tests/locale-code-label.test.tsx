// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { LocalizedField } from '@/components/forms/localized-field';
import { SchemaForm } from '@/components/schema-form';

vi.mock('@/components/forms/media-picker', () => ({ MediaPicker: () => null }));

afterEach(cleanup);

function wrap(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>,
  );
}

/**
 * Sprachkürzel immer rechts in der Labelzeile, ein- wie mehrzeilig (Designer 2026-10-16, Teil 2 Nr. 8; MUSTER § J):
 * Es steht im `<label>` des Feldes, nie im Rahmen der Eingabe.
 */
function expectCodeInLabel(container: HTMLElement, id: string, code: string) {
  const field = container.querySelector<HTMLElement>(`[id="${id}"]`)!;
  expect(field).toBeTruthy();
  const label = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
  expect(label?.textContent).toContain(code);
  // Nicht im Rahmen: Die Eingabe trägt den Rahmen selbst (kein Präfix-Behälter), die Labelzeile steht über ihr.
  expect(field.className).toContain('border');
  expect(field.parentElement!.className).not.toContain('border');
  expect(field.previousElementSibling).toBe(label!.parentElement);
  // Rechts: Das Label steht am Ende seiner Zeile.
  expect(label!.parentElement!.className).toContain('justify-between');
  expect(label!.parentElement!.lastElementChild).toBe(label);
}

describe('Sprachkürzel in der Labelzeile', () => {
  it.each(['input', 'textarea', 'markdown'] as const)('LocalizedField %s', (kind) => {
    const { container } = wrap(<LocalizedField name="name" label="Name" kind={kind} value={{}} locales={['de', 'en']} />);
    expectCodeInLabel(container, 'name-de', 'DE');
    expectCodeInLabel(container, 'name-en', 'EN');
    // Das Label steht einmal, in der Zeile der ersten Sprache.
    const row = container.querySelector('label[for="name-de"]')!.parentElement!;
    expect(row.textContent).toContain('Name');
    expect(container.querySelector('label[for="name-en"]')!.parentElement!.textContent).not.toContain('Name');
  });

  it.each([false, true])('schema-form localized (markdown: %s)', (markdown) => {
    const { container } = wrap(<SchemaForm schema={{ claim: { widget: 'localized', label: 'Claim', markdown } }} value={{}} locales={['de', 'en']} onChange={() => {}} />);
    expectCodeInLabel(container, 'claim.de', 'DE');
    expectCodeInLabel(container, 'claim.en', 'EN');
    expect(container.querySelector('label[for="claim.de"]')!.parentElement!.textContent).toContain('Claim');
  });
});
