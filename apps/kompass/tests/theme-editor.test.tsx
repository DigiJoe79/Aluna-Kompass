// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_THEME, THEME_TOKENS } from '@kompass/core/themes';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/themes/actions', () => ({
  activateThemeAction: vi.fn(),
  deleteThemeAction: vi.fn(),
  duplicateThemeAction: vi.fn(),
  saveThemeAction: vi.fn(),
}));
const { ThemeEditor } = await import('@/app/(shell)/admin/themes/theme-editor');
const { ThemePreview } = await import('@/app/(shell)/admin/themes/theme-preview');
const { THEME_TOKEN_GROUPS } = await import('@/app/(shell)/admin/themes/token-groups');

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
afterEach(cleanup);

const copy = { ...DEFAULT_THEME, key: 'kopie', name: 'Kopie' };

/** Runde 3, 179: Gruppen wie im Rolleneditor, Vorschau mit allen Marken und einem gesperrten Knopf. */
describe('Theme-Editor', () => {
  it('jedes Token steht in genau einer Gruppe, und jede Gruppe hat einen Namen', () => {
    const grouped = THEME_TOKEN_GROUPS.flatMap((g) => g.tokens);
    expect([...grouped].sort()).toEqual([...THEME_TOKENS].sort());
    for (const g of THEME_TOKEN_GROUPS) expect((messages.themes.groups as Record<string, string>)[g.key], g.key).toBeTruthy();
  });

  it('Gruppen klappen auf und zu; „Alle aufklappen“ zeigt jedes Token', () => {
    show(<ThemeEditor themes={[DEFAULT_THEME, copy]} activeKey="default" />);
    fireEvent.click(screen.getByRole('button', { name: /^Kopie/ }));
    const status = screen.getByRole('button', { name: /^Status/ });
    expect(status.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('color-success hell')).toBeNull();
    fireEvent.click(status);
    expect(status.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('color-success hell')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Alle aufklappen' }));
    expect(screen.getByLabelText('muted hell')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alle zuklappen' })).toBeTruthy();
  });

  it('das mitgelieferte Theme heißt „Vorgabe“', () => {
    show(<ThemeEditor themes={[DEFAULT_THEME]} activeKey="default" />);
    expect(screen.getByRole('listitem', { name: 'Vorgabe' })).toBeTruthy();
  });

  it('die Vorschau zeigt die Marken agent, info und final und einen gesperrten Knopf', () => {
    show(<ThemePreview theme={DEFAULT_THEME} mode="dark" />);
    const preview = screen.getByTestId('theme-preview');
    for (const word of ['Vorschlag', 'In Arbeit', 'Festgeschrieben']) expect(within(preview).getByText(word)).toBeTruthy();
    const locked = within(preview).getByRole('button', { name: 'Gesperrt' }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
  });

  // Runde 4 Nachtrag (215): wie `ui/button` — dunkel die Sperrfläche ohne Deckkraft, hell die gedämpfte Primärfläche.
  it('der gesperrte Knopf zeigt dunkel `disabled-bg`/`disabled-ink` mit Rand, hell die gedämpfte Primärfläche', () => {
    show(<ThemePreview theme={DEFAULT_THEME} mode="dark" />);
    const dark = screen.getByTestId('preview-locked-button').className.split(/\s+/);
    expect(dark).toEqual(expect.arrayContaining(['bg-disabled', 'text-disabled-ink', 'border-line-strong']));
    expect(dark).not.toContain('opacity-50');
    cleanup();
    show(<ThemePreview theme={DEFAULT_THEME} mode="light" />);
    const light = screen.getByTestId('preview-locked-button').className.split(/\s+/);
    expect(light).toEqual(expect.arrayContaining(['bg-brand', 'text-on-brand', 'opacity-50']));
  });
});
