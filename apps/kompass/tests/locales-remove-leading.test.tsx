// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { LocalesClient } from '@/app/(shell)/admin/locales/locales-client';

const previewLocaleRemovalAction = vi.fn();
vi.mock('@/app/(shell)/admin/locales/actions', () => ({
  addLocaleAction: vi.fn(async () => ({ status: 'idle' })),
  previewLocaleRemovalAction: (code: string) => previewLocaleRemovalAction(code),
  removeLocaleAction: vi.fn(),
  reorderLocalesAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const wrap = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <LocalesClient locales={['de', 'en']} />
    </NextIntlClientProvider>,
  );

/** Leitsprache entfernen (11-2 A4, Joe 2026-10-16): erlaubt, der Dialog nennt die Folge aus der Vorschau des Dienstes. */
describe('Sprache entfernen', () => {
  it('nennt beim Entfernen der Leitsprache die neue', async () => {
    previewLocaleRemovalAction.mockResolvedValue({ status: 'success', data: { code: 'de', nextLeading: 'en', filled: 0, tables: [] } });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Deutsch entfernen' }));
    expect(await screen.findByText(/Englisch wird Leitsprache\./)).toBeTruthy();
  });

  it('schweigt dazu bei einer anderen Sprache', async () => {
    previewLocaleRemovalAction.mockResolvedValue({ status: 'success', data: { code: 'en', nextLeading: null, filled: 0, tables: [] } });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Englisch entfernen' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText(/wird Leitsprache/)).toBeNull();
  });
});

/** 11-2 A4: Sprachnamen in Liste und Knopf, der Code als Schlüsselzeile darunter. */
describe('Sprachenliste', () => {
  it('nennt die Sprache beim Namen', () => {
    wrap();
    const first = screen.getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('Deutsch');
    expect(first.querySelector('.font-mono')?.textContent).toBe('de');
  });
});
