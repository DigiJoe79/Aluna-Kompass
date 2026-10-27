'use client';

import type { TaxPeriodDocumentSlot, TaxPeriodView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { Notice } from '@/components/notice';
import { TIGHT } from '../audit/report/subject-block';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { FollowUpDialog } from '../deadlines/follow-up-dialog';
import { NoticeDialog } from '../donations/notices/notice-dialog';
import { linkTaxPeriodNoticeAction } from './actions';
import { FilingDatesDialog } from './filing-dates-dialog';
import { TaxDocumentDialog } from './tax-document-dialog';
import type { TaxMe } from './types';

/**
 * Abgegeben, aber die Fassung ist durch Wiederöffnen zurückgenommen (Designer Runde 7, 318, 16b): eine Warnung über der
 * Abgabe mit dem Weg zum Verlauf der Fassungen, wo die Unterschiede stehen.
 */
export function RetractedNotice({ retracted, periodId }: { retracted: { finalizedAt: string; voidedAt: string }; periodId: string }) {
  const t = useTranslations('finance.tax.filing');
  const fmt = useDateFormat();
  return (
    <Notice level="warn" testId="tax-retracted">
      {t('retracted', { date: fmt.date(retracted.finalizedAt), reopened: fmt.date(retracted.voidedAt) })}{' '}
      <Link href={`/finance/reports/taxReturnGem?period=${encodeURIComponent(periodId)}`} className="text-link underline-offset-2 hover:underline">
        {t('differences')}
      </Link>
    </Notice>
  );
}

export interface TaxNotice {
  id: string;
  noticeDate: string;
  documentId: string | null;
  documentNumber: string | null;
}

const linkClass = 'text-meta text-link underline-offset-2 hover:underline';

/**
 * Abschnitt „Abgabe“ über den Werten (Board 10b): drei Tage als `FixedValue` mit „Bearbeiten …“ (Dialog `md`), die
 * Dateien als Zeilen der `RequirementList` (`variant="rows"`, 16b) mit „Ablegen …“ je Zeile. Der Bescheid wartet auf „Abgegeben am“; „Ablegen …“ öffnet den
 * Bescheid-Dialog der Spenden mit vorbelegtem Veranlagungszeitraum und verknüpft danach. Am Bescheid „Wiedervorlage
 * anlegen“ (Ziel: der Zeitraum). Ohne `finance.periodClose` nur lesen.
 */
export function FilingSection({ period, notice, me, finalized = true }: { period: Pick<TaxPeriodView, 'id' | 'label' | 'requestedOn' | 'dueOn' | 'filedOn' | 'version' | 'documents' | 'state'>; notice: TaxNotice | null; me: TaxMe; /** Festgeschrieben: erst dann lassen sich abgegebene Fassung und Protokoll ablegen (16b). */ finalized?: boolean }) {
  const t = useTranslations('finance.tax.filing');
  const tr = useTranslations('finance.tax');
  const fmt = useDateFormat();
  const router = useRouter();
  const [dates, setDates] = useState(false);
  const [slot, setSlot] = useState<TaxPeriodDocumentSlot | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const link = useActionFeedback();

  const request = period.documents.request;
  const docItem = (key: 'filedReturn' | 'transmissionProtocol'): RequirementListItem => {
    const doc = period.documents[key];
    // Vor dem Festschreiben gedämpft und ohne Knopf (Designer Runde 7, 16b).
    const waiting = !doc && !finalized;
    return {
      key,
      title: t(`documents.${key}.title`),
      done: Boolean(doc),
      blocked: waiting,
      blockedText: t('afterFinalize'),
      detail: doc || waiting ? undefined : t(`documents.${key}.detail`),
      canSelf: me.canEdit,
      canDoNames: [],
      canDoText: '',
      href: null,
      actionLabel: t('file'),
      doneLabel: tr('done'),
      extra: doc ? (
        <Link href={`/dms/${doc.documentId}`} className={linkClass} data-testid={`tax-doc-${key}`}>
          {doc.documentNumber}
        </Link>
      ) : me.canEdit && !waiting ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setSlot(key)} data-testid={`tax-file-${key}`}>
          {t('file')}
        </Button>
      ) : undefined,
    };
  };
  const filed = period.filedOn !== null;
  const noticeItem: RequirementListItem = {
    key: 'notice',
    title: t('documents.notice.title'),
    done: notice !== null,
    blocked: !filed,
    blockedText: t('documents.notice.blocked'),
    detail: notice ? t('documents.notice.dated', { date: fmt.date(notice.noticeDate) }) : filed ? t('documents.notice.detail') : undefined,
    canSelf: me.canEdit,
    canDoNames: [],
    canDoText: '',
    href: null,
    actionLabel: t('file'),
    doneLabel: tr('done'),
    extra: notice ? (
      <span className="flex flex-wrap items-center gap-2">
        {notice.documentId ? (
          <Link href={`/dms/${notice.documentId}`} className={linkClass} data-testid="tax-doc-notice">
            {notice.documentNumber ?? t('documents.notice.open')}
          </Link>
        ) : null}
        {me.canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setFollowUp(true)} data-testid="tax-notice-follow-up">
            {t('followUp')}
          </Button>
        ) : null}
      </span>
    ) : filed && me.canEdit ? (
      <Button type="button" variant="outline" size="sm" onClick={() => setNoticeOpen(true)} data-testid="tax-file-notice">
        {t('file')}
      </Button>
    ) : undefined,
  };

  return (
    <FormCard as="section" data-testid="tax-filing">
      <FormCardBody>
        <Section
          title={t('title')}
          actions={
            me.canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDates(true)} data-testid="tax-filing-edit">
                {t('edit')}
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4">
            <FormGrid>
              {/* Eine dichte Wertliste; die Hilfezeile nur bei leerem Wert (Designer Runde 7, 16b). Das Schreiben bleibt Link. */}
              <FixedValue
                id="tax-requested"
                label={t('requestedOn')}
                value={period.requestedOn ? fmt.date(period.requestedOn) : null}
                reason={request ? <Link href={`/dms/${request.documentId}`} className={linkClass}>{t('requestDocument', { number: request.documentNumber })}</Link> : period.requestedOn ? undefined : t('requestNone')}
                size="s"
                className={TIGHT}
              />
              <FixedValue id="tax-due" label={t('dueOn')} value={fmt.date(period.dueOn)} size="s" className={TIGHT} />
              <FixedValue id="tax-filed" label={t('filedOn')} value={period.filedOn ? fmt.date(period.filedOn) : null} reason={period.filedOn ? undefined : t('filedReason')} size="s" testId="tax-filed" className={TIGHT} />
            </FormGrid>
            <RefusalNotice state={link.state} />
            <RequirementList variant="rows" items={[docItem('filedReturn'), docItem('transmissionProtocol'), noticeItem]} />
          </div>
        </Section>
      </FormCardBody>
      {me.canEdit ? (
        <>
          <FilingDatesDialog open={dates} onOpenChange={setDates} period={period} />
          {slot ? <TaxDocumentDialog open onOpenChange={(o) => (o ? undefined : setSlot(null))} periodId={period.id} slot={slot} canPickDocument={me.canPickDocument} /> : null}
          <NoticeDialog
            open={noticeOpen}
            onOpenChange={setNoticeOpen}
            canPickDocument={me.canPickDocument}
            preset={{ assessmentPeriod: period.label, kinds: ['exemptionNotice', 'corporateTaxNoticeAttachment'] }}
            onSaved={(saved) =>
              void link.run(() => linkTaxPeriodNoticeAction({ id: period.id, noticeId: saved.id })).then((result) => {
                if (result.status === 'success') router.refresh();
              })
            }
          />
          {followUp ? (
            <FollowUpDialog
              open
              onOpenChange={(o) => (o ? undefined : setFollowUp(false))}
              years={[]}
              defaultYearId={null}
              preset={{ target: { entityType: 'financeTaxPeriod', entityId: period.id, label: t('followUpTarget', { period: period.label }) } }}
            />
          ) : null}
        </>
      ) : null}
    </FormCard>
  );
}
