// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { LockLine } from '@/components/finance/lock-line';
import { formatDate, formatDateTime, type DateFormatMode } from '@/lib/dates';
import type { DateFormatter } from '@/lib/date-format';
import messages from '../messages/de.json';

afterEach(cleanup);

const fmt = (mode: DateFormatMode, timeZone: string): DateFormatter => ({
  mode,
  timeZone,
  date: (v) => formatDate(v, mode, timeZone),
  dateTime: (v) => formatDateTime(v, mode, timeZone),
});

const line = (f: DateFormatter) => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <LockLine at="2026-09-12T22:30:00Z" userName="Erika" channel="ui" fmt={f} />
    </NextIntlClientProvider>,
  );
  return screen.getByText(/Erika/).textContent;
};

describe('LockLine', () => {
  it('nennt Tag und Uhrzeit in der Zone des Vereins, nicht den UTC-Tag', () => {
    const text = line(fmt('locale', 'Europe/Berlin'));
    expect(text).toContain('13.09.2026');
    expect(text).toContain('00:30');
  });

  it('folgt Zone und Anzeige-Einstellung', () => {
    const text = line(fmt('iso', 'America/New_York'));
    expect(text).toContain('2026-09-12');
    expect(text).toContain('18:30');
  });
});
