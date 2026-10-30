import type { DbOrTx } from '@kompass/core';
import { addCalendarDays } from '@kompass/module-finance';
import { LAW_NOTICE_HINT_DAYS } from '../rules/law';
import { resolveRule } from '../rules/resolve';
import { statuteRulesOnInternal } from '../statutes';

/**
 * Der letzte Tag, an dem etwas vor `heldOn` eingehen muss, damit dazwischen `days` volle Tage liegen: Sitzungstag und
 * Zugangstag zählen nicht (§§ 187 Abs. 1, 188 Abs. 1 BGB rückwärts). Kein Verschieben auf Werktage — § 193 BGB gilt
 * rückwärts nicht. Für Einladungs- und Antragsfrist.
 */
export const lastDayBefore = (heldOn: string, days: number): string => addCalendarDays(heldOn, -days - 1);

export interface NoticeDeadline {
  statuteId: string | null;
  noticeDays: number | null;
  strictness: 'must' | 'should' | null;
  from: 'sent' | 'received';
  /** Letzter Tag des Zugangs (bei `sent`: der Absendung); `null` ohne Frist. */
  lastReceiptDay: string | null;
  /** Spätester Tag der Absendung je Weg (Laufzeit aus dem Regelwerk). */
  sendBy: { email: string | null; post: string | null };
  motionsBy: string | null;
  /** Ohne Frist: „angemessen?“ ab diesem Tag (Rechtsprechung, 14 Tage). */
  lawHintDay: string;
  source: 'statute' | 'law';
  norm?: string;
}

/** Die Einladungsfrist einer Sitzung aus dem Regelwerk, das am Sitzungstag gilt (Spec § 5.2). */
export function noticeDeadlineInternal(db: DbOrTx, organId: string, heldOn: string): NoticeDeadline {
  const { statuteId, rules } = statuteRulesOnInternal(db, heldOn);
  const notice = resolveRule(rules, organId, 'noticeDays');
  const from = resolveRule(rules, organId, 'noticeFrom').value ?? 'received';
  const transit = resolveRule(rules, organId, 'transitDays').value ?? { email: 1, post: 3 };
  const motionDays = resolveRule(rules, organId, 'motionDeadlineDays').value;
  const days = notice.value ?? null;
  const lastReceiptDay = days === null ? null : lastDayBefore(heldOn, days);
  const sendBy =
    lastReceiptDay === null ? { email: null, post: null }
    : from === 'sent' ? { email: lastReceiptDay, post: lastReceiptDay }
    : { email: addCalendarDays(lastReceiptDay, -transit.email), post: addCalendarDays(lastReceiptDay, -transit.post) };
  return {
    statuteId,
    noticeDays: days,
    strictness: days === null ? null : (resolveRule(rules, organId, 'noticeStrictness').value ?? 'must'),
    from,
    lastReceiptDay,
    sendBy,
    motionsBy: motionDays === undefined ? null : lastDayBefore(heldOn, motionDays),
    lawHintDay: lastDayBefore(heldOn, LAW_NOTICE_HINT_DAYS),
    source: notice.source,
    ...(notice.norm ? { norm: notice.norm } : {}),
  };
}
