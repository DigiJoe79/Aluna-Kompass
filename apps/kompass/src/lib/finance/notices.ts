import type { NoticeView } from '@kompass/module-finance';

/**
 * Bescheide in der Oberfläche (C3, F6a Task 8). Nur Anzeige aus dem, was
 * `listNotices` liefert — Gültigkeit und Zustand rechnet der Dienst.
 */
type NoticeLike = Pick<NoticeView, 'state' | 'supersededOn' | 'voidedAt' | 'documentId'>;

export interface NoticeStateDisplay {
  key: 'valid' | 'endsOn' | 'expired' | 'superseded' | 'supersededByFinal' | 'voided' | 'future';
  date: string | null;
}

/** Der Kalendertag davor (`2024-03-01` → `2024-02-29`). */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Der Zustand als Satzschlüssel: Ein gültiger Bescheid, der ab einem späteren
 * Tag aufgehoben ist, trägt bis zum Tag davor („endet mit Ablauf des …“); ein
 * ersetzter ohne eigenes Datum ist ein § 60a-Bescheid, dem der endgültige
 * folgte.
 */
export function noticeStateDisplay(notice: NoticeLike): NoticeStateDisplay {
  if (notice.state === 'valid' && notice.supersededOn) return { key: 'endsOn', date: dayBefore(notice.supersededOn) };
  if (notice.state === 'superseded') return notice.supersededOn ? { key: 'superseded', date: notice.supersededOn } : { key: 'supersededByFinal', date: null };
  return { key: notice.state, date: null };
}

/** Was sich an einem Bescheid noch tun lässt — die Dienste lehnen dasselbe ab (`noticeSuperseded`, `noticeVoided`). */
export function noticeActions(notice: NoticeLike): { supersede: boolean; void: boolean; attach: boolean } {
  const open = notice.voidedAt === null && notice.supersededOn === null;
  return { supersede: open, void: notice.voidedAt === null, attach: open && notice.documentId === null };
}
