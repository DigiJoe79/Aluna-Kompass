// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateFormatProvider, useDateFormat } from '@/components/date-format-provider';
import type { DateFormatMode } from '@/lib/dates';

afterEach(cleanup);

function Probe({ value }: { value: string }) {
  const fmt = useDateFormat();
  return (
    <p>
      <span data-testid="date">{fmt.date(value)}</span>
      <span data-testid="time">{fmt.dateTime(value)}</span>
    </p>
  );
}

const show = (mode: DateFormatMode, timeZone: string, value: string) => {
  render(
    <DateFormatProvider mode={mode} timeZone={timeZone}>
      <Probe value={value} />
    </DateFormatProvider>,
  );
  return { date: screen.getByTestId('date').textContent, time: screen.getByTestId('time').textContent };
};

describe('DateFormatProvider', () => {
  it('ein Zeitstempel zeigt den Tag in der Zone des Vereins, nicht den UTC-Tag', () => {
    expect(show('locale', 'Europe/Berlin', '2026-09-12T22:30:00Z')).toEqual({ date: '13.09.2026', time: '13.09.2026, 00:30' });
  });

  it('nimmt die Zone, die die Schale durchreicht', () => {
    expect(show('iso', 'America/New_York', '2026-09-12T22:30:00Z')).toEqual({ date: '2026-09-12', time: '2026-09-12 18:30' });
  });

  it('ein reiner Tag bleibt derselbe Tag', () => {
    expect(show('locale', 'America/New_York', '2026-09-12').date).toBe('12.09.2026');
  });
});
