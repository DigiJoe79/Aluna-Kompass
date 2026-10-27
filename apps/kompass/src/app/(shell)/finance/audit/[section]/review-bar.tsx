'use client';

import type { AuditSection } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button, buttonVariants } from '@/components/ui/button';
import { joinNames } from '../audit-header';
import { markReviewedAction, unmarkReviewedAction } from '../actions';

/**
 * Ende einer Abschnittsseite (Board 4b): „Abschnitt durchgesehen“ je Prüfer (`outline`), mit „Durchsicht
 * zurücknehmen“; wer ihn sonst durchgesehen hat, steht als Satz daneben. Rechts „Weiter mit <n+1>. <Abschnitt>“.
 */
export function ReviewBar({
  yearId,
  section,
  auditorView,
  reviewedByMeAt,
  others,
  reviewedBefore,
  next,
  fixedSince = null,
}: {
  yearId: string;
  section: AuditSection;
  auditorView: boolean;
  reviewedByMeAt: string | null;
  others: string[];
  /** Nachprüfung: die frühere Durchsicht, die für den neuen Prüfstand nicht mehr gilt (gedämpft, keine Marke). */
  reviewedBefore: { names: string[]; at: string } | null;
  next: { section: AuditSection; n: number; title: string } | null;
  /** Seit der Ablage des Prüfberichts steht die Durchsicht fest: statt des Knopfs der Satz (274/279). */
  fixedSince?: string | null;
}) {
  const t = useTranslations('finance.audit');
  const fmt = useDateFormat();
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    setPending(true);
    const result = await feedback.run(() => (reviewedByMeAt ? unmarkReviewedAction(yearId, section) : markReviewedAction(yearId, section)), { retry: () => void toggle() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  return (
    <div className="flex flex-col gap-2">
      <RefusalNotice action state={feedback.state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {auditorView && fixedSince ? (
            <span className="text-meta text-muted-ink" data-testid="audit-work-fixed">
              {t('section.fixed', { date: fmt.date(fixedSince) })}
            </span>
          ) : auditorView ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => void toggle()} data-testid="audit-section-review">
              {reviewedByMeAt ? t('section.unreview') : t('section.reviewed')}
            </Button>
          ) : null}
          {reviewedByMeAt ? <span className="text-meta text-muted-ink">{t('section.reviewedByMe', { date: fmt.date(reviewedByMeAt) })}</span> : null}
          {others.length > 0 ? <span className="text-meta text-muted-ink">{t('section.reviewedByOthers', { names: joinNames(others, t('head.and')) })}</span> : null}
          {reviewedBefore && reviewedBefore.names.length > 0 ? <span className="text-meta text-muted-ink">{t('section.reviewedBefore', { names: joinNames(reviewedBefore.names, t('head.and')), date: fmt.date(reviewedBefore.at) })}</span> : null}
        </div>
        {next ? (
          <Link href={`/finance/audit/${next.section}?year=${encodeURIComponent(yearId)}`} className={buttonVariants({ variant: 'outline' })}>
            {t('section.next', { n: next.n, title: next.title })}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
