/**
 * Wie lange ein Bescheid trägt (Spec 7.1, E14) — rein: kein `@kompass/*`,
 * kein relativer Import, der Stichtag ist ein Parameter (Wächter:
 * `tests/notice-validity.test.ts`). F6a rechnet damit die Bescheide des
 * Vereins, F7 die der Empfänger (§ 58a AO) mit dem Zahlungstag.
 *
 * Taggenau und einschließlich: Ein § 60a-Bescheid trägt drei Jahre ab seinem
 * Datum, Freistellungsbescheid und Anlage zum Körperschaftsteuerbescheid fünf.
 * Ein Bescheid vom 29. Februar endet am 28. Februar des Zieljahres, wenn es
 * dort keinen 29. gibt.
 */
export type NoticeKind = 'section60a' | 'exemptionNotice' | 'corporateTaxNoticeAttachment';

export const NOTICE_KINDS = ['section60a', 'exemptionNotice', 'corporateTaxNoticeAttachment'] as const satisfies readonly NoticeKind[];

export interface NoticeValidityInput {
  kind: NoticeKind;
  /** `YYYY-MM-DD` */
  noticeDate: string;
  /** „aufgehoben oder ersetzt am“ — ab diesem Tag trägt der Bescheid nicht mehr. */
  supersededOn: string | null;
  /** „irrtümlich erfasst“ — dann trug er nie. */
  voidedAt: string | null;
}

const YEARS: Record<NoticeKind, number> = { section60a: 3, exemptionNotice: 5, corporateTaxNoticeAttachment: 5 };

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Letzter Tag, an dem der Bescheid trägt (einschließlich). */
export function noticeValidUntil(kind: NoticeKind, noticeDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(noticeDate);
  if (!match) throw new Error(`noticeValidUntil: malformed date ${JSON.stringify(noticeDate)}`);
  const year = Number(match[1]) + YEARS[kind];
  const month = match[2]!;
  const day = month === '02' && match[3] === '29' && !isLeapYear(year) ? '28' : match[3]!;
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * Der jüngste Bescheid, der am Stichtag trägt: `noticeDate ≤ date ≤
 * validUntil`, nicht ersetzt bis zum Stichtag, nie irrtümlich erfasst. Ein
 * § 60a-Bescheid trägt nicht mehr, sobald ein späterer Freistellungsbescheid
 * oder eine spätere Anlage zum Körperschaftsteuerbescheid mit Datum bis zum
 * Stichtag vorliegt — auch wenn dieser seinerseits ersetzt wurde.
 */
export function noticeValidAt<T extends NoticeValidityInput>(notices: readonly T[], date: string): { notice: T; validUntil: string } | null {
  const genuine = notices.filter((n) => n.voidedAt === null);
  const candidates = genuine
    .filter((n) => n.noticeDate <= date && (n.supersededOn === null || n.supersededOn > date))
    .map((n) => ({ notice: n, validUntil: noticeValidUntil(n.kind, n.noticeDate) }))
    .filter((c) => date <= c.validUntil)
    .filter((c) => c.notice.kind !== 'section60a' || !genuine.some((other) => other.kind !== 'section60a' && other.noticeDate > c.notice.noticeDate && other.noticeDate <= date));
  if (candidates.length === 0) return null;
  // Der jüngste nach Datum; bei gleichem Datum schlägt der endgültige Bescheid den vorläufigen.
  candidates.sort((a, b) => b.notice.noticeDate.localeCompare(a.notice.noticeDate) || Number(a.notice.kind === 'section60a') - Number(b.notice.kind === 'section60a'));
  return candidates[0]!;
}
