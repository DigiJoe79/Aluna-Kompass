// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/locales/actions', () => ({
  addLocaleAction: vi.fn(),
  previewLocaleRemovalAction: vi.fn(async () => ({ status: 'success', data: { filled: 0, nextLeading: 'en' } })),
  removeLocaleAction: vi.fn(),
  reorderLocalesAction: vi.fn(),
}));
const { LocalesClient } = await import('@/app/(shell)/admin/locales/locales-client');
afterEach(cleanup);

const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <LocalesClient locales={['de', 'en']} />
    </NextIntlClientProvider>,
  );

/** Runde 3, 180: Entfernen im ⋯-Menü (die Pfeile bleiben), Vorschläge mit Namen, der Dialog nennt die neue Leitsprache. */
describe('LocalesClient', () => {
  it('kein Knopf „… entfernen“ in der Zeile, „Entfernen …“ im Menü; der Dialog nennt die neue Leitsprache', async () => {
    show();
    expect(screen.queryByRole('button', { name: 'Deutsch entfernen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Deutsch' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entfernen …' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Englisch wird Leitsprache.');
  });

  it('schlägt Sprachen mit Namen vor', () => {
    show();
    const input = screen.getByLabelText('Sprachcode') as HTMLInputElement;
    const list = document.getElementById(input.getAttribute('list') ?? '');
    expect(list?.querySelector('option[value="fr"]')?.getAttribute('label')).toBe('Französisch (fr)');
    expect(list?.querySelector('option[value="en"]')).toBeNull();
  });
});
