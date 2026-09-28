'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';

/** Welche Nachfragen der Dienst zuletzt verlangt hat — gesammelt, weil er sie einzeln meldet. */
export interface PartnerReasonNeeds {
  notice: boolean;
  overdue: boolean;
  /** Befund Q: ein Zweck ginge durch die Geldpositionen ins Minus (nur beim Einreichen gefragt). */
  purpose?: boolean;
}

/**
 * Die Nachfragen einer Zahlung an Partner (D2, Design-Abgleich Phase 4): Gilt
 * am Zahlungstag kein Bescheid oder sind beim Partner Nachweise überfällig,
 * verlangt der Dienst je eine eigene Begründung. Entwurf (E2) und
 * Freigabe-Detail zeigen sie gleich — jede mit eigener Beschriftung und dem
 * Satz, warum gefragt wird.
 */
export function PartnerReasonPrompt({
  needs,
  noticeReason,
  overdueReason,
  onNoticeReason,
  onOverdueReason,
  noticeValidUntil,
  purposeReason = '',
  onPurposeReason,
  purposeDetail,
}: {
  needs: PartnerReasonNeeds;
  noticeReason: string;
  overdueReason: string;
  onNoticeReason: (value: string) => void;
  onOverdueReason: (value: string) => void;
  /** Ende des jüngsten Bescheids, für den Satz „Der letzte Bescheid galt bis …“ (Design-Nachtrag Phase 4). */
  noticeValidUntil?: string | null;
  purposeReason?: string;
  onPurposeReason?: (value: string) => void;
  /** Der Satz des Dienstes mit Zweck und Bestand danach, sobald er abgelehnt hat. */
  purposeDetail?: string | null;
}) {
  const t = useTranslations('finance.partners.payment.reasons');
  const fmt = useDateFormat();
  const purpose = !!needs.purpose && !!onPurposeReason;
  if (!needs.notice && !needs.overdue && !purpose) return null;
  return (
    <section className="space-y-2" data-testid="reason-prompt">
      {needs.notice ? (
        <Notice level="warn" reason={{ name: 'notice-reason', value: noticeReason, onChange: onNoticeReason, label: t('noticeLabel') }}>
          {t('noticeHint')}
          {noticeValidUntil ? ` ${t('noticeUntil', { date: fmt.date(noticeValidUntil) })}` : null}
        </Notice>
      ) : null}
      {needs.overdue ? (
        <Notice level="warn" reason={{ name: 'overdue-reason', value: overdueReason, onChange: onOverdueReason, label: t('overdueLabel') }}>
          {t('overdueHint')}
        </Notice>
      ) : null}
      {purpose ? (
        <div data-testid="purpose-reason">
          <Notice level="warn" reason={{ name: 'purpose-reason', value: purposeReason, onChange: onPurposeReason!, label: t('purposeLabel') }}>
            {purposeDetail ?? t('purposeHint')}
          </Notice>
        </div>
      ) : null}
    </section>
  );
}
