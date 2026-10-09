// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function Clock({ value }: { value: string }) {
  const fmt = useDateFormat();
  return (
    <p>
      <span data-testid="time">{fmt.time(value)}</span>
      <span data-testid="stamp">{fmt.stamp(value)}</span>
      <span data-testid="seconds">{fmt.dateTime(value, { seconds: true })}</span>
    </p>
  );
}

describe('useDateFormat: Uhrzeit, Stempel, Sekunden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (value: string) =>
    render(
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <Clock value={value} />
      </DateFormatProvider>,
    );

  it('time und Sekunden in der Zone des Vereins', () => {
    vi.setSystemTime(new Date('2026-09-12T16:00:00Z'));
    mount('2026-09-12T15:35:07Z');
    expect(screen.getByTestId('time').textContent).toBe('17:35');
    expect(screen.getByTestId('seconds').textContent).toBe('12.09.2026, 17:35:07');
  });

  it('ein offener Entwurf zeigt nach Mitternacht das Datum, ohne Neuladen', () => {
    vi.setSystemTime(new Date('2026-09-12T21:58:00Z')); // 23:58 Berlin
    mount('2026-09-12T21:57:00Z');
    expect(screen.getByTestId('stamp').textContent).toBe('23:57');
    act(() => {
      vi.advanceTimersByTime(3 * 60_000); // 00:01 am 13.09.
    });
    expect(screen.getByTestId('stamp').textContent).toBe('12.09.2026, 23:57');
  });
});
