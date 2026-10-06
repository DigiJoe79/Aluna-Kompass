// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_TOKENS } from '@kompass/core/themes';
import { ThemeEditor } from '@/app/(shell)/admin/themes/theme-editor';
import messages from '../messages/de.json';

const duplicateThemeAction = vi.fn();
vi.mock('@/app/(shell)/admin/themes/actions', () => ({
  activateThemeAction: vi.fn(),
  deleteThemeAction: vi.fn(),
  saveThemeAction: vi.fn(),
  duplicateThemeAction: (...args: unknown[]) => duplicateThemeAction(...args),
}));

afterEach(cleanup);

const tokens = Object.fromEntries(
  THEME_TOKENS.map((k) => [k, { light: '#2F5D68', dark: '#2F5D68' }]),
) as never;

describe('Erscheinungsbild duplizieren', () => {
  it('zeigt die Ablehnung des Schlüssels am Feld, der Dialog bleibt offen', async () => {
    duplicateThemeAction.mockResolvedValue({
      status: 'error',
      message: 'Eingabe ungültig',
      fieldErrors: { key: 'Nur Kleinbuchstaben, Ziffern und Bindestrich' },
    });
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ThemeEditor themes={[{ key: 'default', name: 'Default', tokens }]} activeKey="default" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplizieren' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Schlüssel'), { target: { value: 'Vereinsfarben' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Vereinsfarben' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplizieren' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Nur Kleinbuchstaben, Ziffern und Bindestrich')).toBeTruthy());
    expect(within(screen.getByRole('dialog')).getByLabelText('Schlüssel').getAttribute('aria-invalid')).toBe('true');
  });
});
