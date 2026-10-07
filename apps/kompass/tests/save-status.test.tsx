// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { DateFormatProvider } from '@/components/date-format-provider';
import { SaveStatus } from '@/components/forms/save-status';
import messages from '../messages/de.json';

afterEach(cleanup);

const status = (timeZone: string) => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone={timeZone}>
        <SaveStatus state={{ kind: 'saved', at: '2026-09-12T22:30:00Z' }} pending={false} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('save-status').textContent;
};

describe('SaveStatus', () => {
  it('nennt die Uhrzeit in der Zone des Vereins', () => {
    expect(status('Europe/Berlin')).toContain('00:30');
  });

  it('nicht fest Berlin: die Zone kommt von der Schale', () => {
    expect(status('America/New_York')).toContain('18:30');
  });
});
