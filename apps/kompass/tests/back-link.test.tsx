// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { BackLink } from '@/components/back-link';

const back = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ back, replace }) }));

afterEach(() => {
  cleanup();
  back.mockClear();
  replace.mockClear();
  vi.unstubAllGlobals();
});

function stubNavigation(canGoBack: boolean, previousUrl = 'http://localhost/kontakt') {
  const entries = [{ url: previousUrl }, { url: 'http://localhost/dms/1/edit' }];
  vi.stubGlobal('navigation', { canGoBack, currentEntry: { index: 1 }, entries: () => entries, addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

function renderLink(mode: 'origin' | 'parent' = 'origin') {
  render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <BackLink href="/dms" label="Akte" mode={mode} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('link');
}

describe('BackLink', () => {
  it('ohne Navigation API bleibt der Rückfall stehen', () => {
    const link = renderLink();
    expect(link.textContent).toContain('Akte');
    expect(link.getAttribute('href')).toBe('/dms');
  });

  it('ohne Vorseite im Tab bleibt der Rückfall stehen und geht nicht zurück', () => {
    stubNavigation(false);
    const link = renderLink();
    expect(link.textContent).toContain('Akte');
    fireEvent.click(link);
    expect(back).not.toHaveBeenCalled();
  });

  it('mit Vorseite heißt er „Zurück“ und geht im Verlauf zurück, das Ziel bleibt ein echter Link', () => {
    stubNavigation(true);
    const link = renderLink();
    expect(link.textContent).toContain('Zurück');
    expect(link.getAttribute('href')).toBe('/dms');
    fireEvent.click(link);
    expect(back).toHaveBeenCalledOnce();
  });

  it('zur Elternseite bleibt der Name stehen; ist sie die Vorseite, geht er im Verlauf zurück', () => {
    stubNavigation(true, 'http://localhost/dms');
    const link = renderLink('parent');
    expect(link.textContent).toContain('Akte');
    fireEvent.click(link);
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('zur Elternseite ohne sie als Vorseite: Der Eintrag wird ersetzt, nichts wächst im Verlauf', () => {
    stubNavigation(true);
    fireEvent.click(renderLink('parent'));
    expect(replace).toHaveBeenCalledWith('/dms');
    expect(back).not.toHaveBeenCalled();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Strg', { ctrlKey: true }],
    ['Umschalt', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['Mitteltaste', { button: 1 }],
  ])('%s-Klick bleibt ein Link', (_name, init) => {
    stubNavigation(true);
    fireEvent.click(renderLink(), init);
    expect(back).not.toHaveBeenCalled();
  });
});
