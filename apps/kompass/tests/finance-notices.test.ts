import { describe, expect, it } from 'vitest';
import { dayBefore, noticeActions, noticeStateDisplay } from '@/lib/finance/notices';

const notice = (over: Partial<Parameters<typeof noticeStateDisplay>[0]> = {}) => ({ state: 'valid' as const, supersededOn: null, voidedAt: null, documentId: null, ...over });

describe('Bescheide in der Oberfläche (F6a Task 8)', () => {
  it('counts back one calendar day, across months, years and february 29', () => {
    expect(dayBefore('2026-09-26')).toBe('2026-09-25');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2024-03-01')).toBe('2024-02-29');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('shows the day a still valid notice ends once it is superseded from a later day', () => {
    expect(noticeStateDisplay(notice())).toEqual({ key: 'valid', date: null });
    expect(noticeStateDisplay(notice({ supersededOn: '2026-09-26' }))).toEqual({ key: 'endsOn', date: '2026-09-25' });
    expect(noticeStateDisplay(notice({ state: 'superseded', supersededOn: '2026-09-25' }))).toEqual({ key: 'superseded', date: '2026-09-25' });
    // Ein § 60a-Bescheid, dem ein endgültiger folgt, ist ersetzt — ohne eigenes Datum.
    expect(noticeStateDisplay(notice({ state: 'superseded' }))).toEqual({ key: 'supersededByFinal', date: null });
    expect(noticeStateDisplay(notice({ state: 'voided', voidedAt: '2026-09-25T10:00:00.000Z' }))).toEqual({ key: 'voided', date: null });
    expect(noticeStateDisplay(notice({ state: 'expired' }))).toEqual({ key: 'expired', date: null });
    expect(noticeStateDisplay(notice({ state: 'future' }))).toEqual({ key: 'future', date: null });
  });

  it('offers supersede once, void once, and a document only while the notice counts and has none', () => {
    expect(noticeActions(notice())).toEqual({ supersede: true, void: true, attach: true });
    expect(noticeActions(notice({ documentId: 'D1' }))).toEqual({ supersede: true, void: true, attach: false });
    expect(noticeActions(notice({ supersededOn: '2026-09-26' }))).toEqual({ supersede: false, void: true, attach: false });
    expect(noticeActions(notice({ state: 'voided', voidedAt: '2026-09-25T10:00:00.000Z' }))).toEqual({ supersede: false, void: false, attach: false });
  });
});
