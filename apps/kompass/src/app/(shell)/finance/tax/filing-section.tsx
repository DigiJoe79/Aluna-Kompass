'use client';

import type { TaxPeriodView } from '@kompass/module-finance';
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
import { FilingDatesDialog, type AmendmentField } from './filing-dates-dialog';
import { TaxNoticeDialog } from './notice-dialog';
import { ReviewCloseDialog } from './review-close-dialog';
import { filingDocumentsOf, type FilingSlot } from './review-state';
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
 *
 * B9 (Spec 0.5.2 § 6): „Abgegeben am“ bleibt der erste Tag, darunter „Berichtigt am“ (letzte Berichtigung, ohne
 * Person); die Dokumentzeilen gehören zur letzten Abgabe. „Berichtigung eintragen …“ steht in den Aktionen des
 * Abschnitts, solange eine Berichtigung eintragbar ist und es einen Anlass gibt. Bei offenem Prüfanlass dazu
 * „Anzeige eintragen …“ (Dialog `sm`) und „Ohne Berichtigung schließen …“ (Dialog `md`); eine Prüfung ohne Berichtigung
 * steht als „Geprüft am“ mit Person und Begründung, eine Anzeige als „Angezeigt am“ mit der Zeile für das Schreiben.
 */
export function FilingSection({
  period,
  notice,
  me,
  finalized = true,
  retracted = false,
  userNames = {},
}: {
  period: Pick<TaxPeriodView, 'id' | 'label' | 'requestedOn' | 'dueOn' | 'filedOn' | 'version' | 'documents' | 'state' | 'reviewDue' | 'amendmentAllowed' | 'filedFiguresMissing' | 'amendments' | 'checks' | 'notifiedOn'>;
  notice: TaxNotice | null;
  me: TaxMe;
  /** Festgeschrieben: erst dann lassen sich abgegebene Fassung und Protokoll ablegen (16b). */
  finalized?: boolean;
  /** Die abgegebene Fassung ist storniert (Wiederöffnen): Ohne Abbild ist dann eine Berichtigung denkbar. */
  retracted?: boolean;
  /** Namen zu den Nutzer-IDs der Prüfungen („geprüft von …“). */
  userNames?: Record<string, string>;
}) {
  const t = useTranslations('finance.tax.filing');
  const tr = useTranslations('finance.tax');
  const fmt = useDateFormat();
  const router = useRouter();
  const [dates, setDates] = useState<'edit' | 'amend' | null>(null);
  const [slot, setSlot] = useState<FilingSlot | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [review, setReview] = useState<'notice' | 'close' | null>(null);
  const link = useActionFeedback();

  const request = period.documents.request;
  const filing = filingDocumentsOf(period);
  const lastAmendment = period.amendments.at(-1) ?? null;
  const placeOf = (key: 'filedReturn' | 'transmissionProtocol'): FilingSlot => (filing.target === 'amendment' ? { slot: key, target: 'amendment', amendmentId: filing.amendmentId } : { slot: key });
  const docItem = (key: 'filedReturn' | 'transmissionProtocol'): RequirementListItem => {
    const doc = filing.documents[key];
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
        <Button type="button" variant="outline" size="sm" onClick={() => setSlot(placeOf(key))} data-testid={`tax-file-${key}`}>
          {t('file')}
        </Button>
      ) : undefined,
    };
  };
  const filed = period.filedOn !== null;
  // Eintragbar ist eine Berichtigung, solange die Werte von der letzten Abgabe abweichen; ohne Abbild (vor 0.5.2) erst,
  // wenn die abgegebene Fassung storniert ist — sonst stünde der Knopf an jeder alten Abgabe.
  const canAmend = me.canEdit && filed && period.amendmentAllowed && (period.reviewDue || !period.filedFiguresMissing || retracted);
  // Die letzte Prüfung ohne Berichtigung gilt, solange keine Berichtigung nach ihr kam; die Anzeige des laufenden Anlasses.
  const lastCheck = period.checks.filter((c) => c.kind === 'noAmendment').at(-1) ?? null;
  const shownCheck = lastCheck && (!lastAmendment || lastCheck.at > lastAmendment.at) ? lastCheck : null;
  const notice_ = period.notifiedOn ? (period.checks.filter((c) => c.kind === 'notified').at(-1) ?? null) : null;
  const noticeLetterItem: RequirementListItem | null = notice_
    ? {
        key: 'noticeLetter',
        title: t('documents.noticeLetter.title'),
        done: Boolean(notice_.document),
        blocked: false,
        detail: notice_.document ? undefined : t('documents.noticeLetter.detail'),
        canSelf: me.canEdit,
        canDoNames: [],
        canDoText: '',
        href: null,
        actionLabel: t('file'),
        doneLabel: tr('done'),
        extra: notice_.document ? (
          <Link href={`/dms/${notice_.document.documentId}`} className={linkClass} data-testid="tax-doc-noticeLetter">
            {notice_.document.documentNumber}
          </Link>
        ) : me.canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setSlot({ slot: 'notice', target: 'notice' })} data-testid="tax-file-noticeLetter">
            {t('file')}
          </Button>
        ) : undefined,
      }
    : null;
  const amendmentField: AmendmentField | null = dates === 'amend' ? { mode: 'record' } : lastAmendment ? { mode: 'edit', id: lastAmendment.id, filedOn: lastAmendment.filedOn } : null;
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
              <span className="flex flex-wrap items-center gap-2">
                {canAmend ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setDates('amend')} data-testid="tax-amend">
                    {t('amend')}
                  </Button>
                ) : null}
                {period.reviewDue ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => setReview('notice')} data-testid="tax-notify">
                      {t('notify')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setReview('close')} data-testid="tax-review-close">
                      {t('closeReview')}
                    </Button>
                  </>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={() => setDates('edit')} data-testid="tax-filing-edit">
                  {t('edit')}
                </Button>
              </span>
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
              {lastAmendment ? <FixedValue id="tax-amended" label={t('amendedOn')} value={fmt.date(lastAmendment.filedOn)} reason={t('amendedReason')} size="s" testId="tax-amended" className={TIGHT} /> : null}
              {shownCheck ? (
                <FixedValue
                  id="tax-checked"
                  label={t('checkedOn')}
                  value={fmt.date(shownCheck.checkedOn)}
                  reason={
                    <>
                      {t('checkedReason', { name: userNames[shownCheck.byUserId] ?? '', reason: shownCheck.reason ?? '' })}
                      {shownCheck.document ? (
                        <>
                          {' '}
                          <Link href={`/dms/${shownCheck.document.documentId}`} className={linkClass}>
                            {t('checkedDocument', { number: shownCheck.document.documentNumber })}
                          </Link>
                        </>
                      ) : null}
                    </>
                  }
                  size="l"
                  testId="tax-checked"
                  className={TIGHT}
                />
              ) : null}
              {period.notifiedOn ? <FixedValue id="tax-notified" label={t('notifiedOn')} value={fmt.date(period.notifiedOn)} reason={t('notifiedReason')} size="s" testId="tax-notified" className={TIGHT} /> : null}
            </FormGrid>
            <RefusalNotice state={link.state} />
            <RequirementList variant="rows" items={[docItem('filedReturn'), docItem('transmissionProtocol'), ...(noticeLetterItem ? [noticeLetterItem] : []), noticeItem]} />
          </div>
        </Section>
      </FormCardBody>
      {me.canEdit ? (
        <>
          <TaxNoticeDialog open={review === 'notice'} onOpenChange={(o) => (o ? undefined : setReview(null))} periodId={period.id} periodLabel={period.label} notifiedOn={period.notifiedOn} />
          <ReviewCloseDialog open={review === 'close'} onOpenChange={(o) => (o ? undefined : setReview(null))} periodId={period.id} periodLabel={period.label} canPickDocument={me.canPickDocument} />
          <FilingDatesDialog open={dates !== null} onOpenChange={(o) => (o ? undefined : setDates(null))} period={period} amendment={amendmentField} />
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
