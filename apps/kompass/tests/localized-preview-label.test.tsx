// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/lib/markdown-preview', () => ({ renderMarkdownAction: vi.fn(async () => '') }));
const { LocalizedField } = await import('@/components/forms/localized-field');
afterEach(cleanup);

/** Runde 3, 190: Die Vorschau zeigt nur den Langtext — sie sagt, wessen Vorschau sie ist. */
describe('LocalizedField, Vorschau', () => {
  it('heißt „Vorschau Langtext“', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <LocalizedField name="body" label="Langtext" kind="markdown" value={{ de: 'Text' }} locales={['de', 'en']} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Vorschau Langtext')).toBeTruthy();
  });
});
