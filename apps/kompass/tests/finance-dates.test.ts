import { describe, expect, it } from 'vitest';
import { formatDate } from '@/lib/dates';
import { formatDateOrDash } from '@/lib/finance/dates';

describe('formatDateOrDash', () => {
  const fmt = (value: string | null | undefined) => formatDate(value, 'locale');

  it('formats an ISO date through the given formatter', () => {
    expect(formatDateOrDash(fmt, '2026-03-12')).toBe('12.03.2026');
  });

  it('shows a dash for null', () => {
    expect(formatDateOrDash(fmt, null)).toBe('—');
  });

  it('shows a dash for an empty string', () => {
    expect(formatDateOrDash(fmt, '')).toBe('—');
  });

  it('shows a dash for undefined', () => {
    expect(formatDateOrDash(fmt, undefined)).toBe('—');
  });
});
