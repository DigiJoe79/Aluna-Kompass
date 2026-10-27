'use client';

import type { VatAmendmentPayment, VatFilingView } from '@kompass/module-finance';
import { vatFilingOpensOn } from '@kompass/module-finance/vat-calendar';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormGrid } from '@/components/forms/form-grid';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { TIGHT } from '../audit/report/subject-block';
import { VatDialog } from '../deadlines/vat-dialog';
import { FilingDocumentDialog } from '../tax/tax-document-dialog';
import { fileVatFilingDocumentAction, linkVatFilingDocumentAction } from './actions';

const linkClass = 'text-meta text-link underline-offset-2 hover:underline';

/**
 * Abgabe-Karte der Voranmeldung (Board 8a/8b, Muster `FilingSection` 16b ohne „Angefordert“ und Bescheid): Frist mit
 * Zeitraumart und Dauerfristverlängerung, „Abgegeben am“ der letzten Abgabe, „Zu zahlen“ (Kz 83, negativ ein Überschuss);
 * darunter die Dokumente der letzten Abgabe und bei offener Berichtigung die berichtigte Fassung. „Bearbeiten …“ öffnet
 * den Dialog der Fristen: ohne Abgabe oder bei offener Berichtigung eine neue Abgabe, sonst Tag und Protokoll der letzten.
 * Die abgegebene Fassung ist das PDF aus ELSTER (Board 8b: Zeile mit Haken und Nummer der Akte); mit festgeschriebener
 * Fassung trägt ihre Zeile „Ablegen …“ wie die Steuererklärung (16b), sonst wäre sie eine Sackgasse (Befund 30 a).
 */
export function VatFilingCard({
  periodKey,
  periodLabel,
  dueOn,
  kind,
  permanentExtension,
  resultCents,
  lastFiling,
  amendmentDue,
  amendmentPayment = null,
  finalized,
  canEdit,
  canPickDocument = false,
  today,
}: {
  periodKey: string;
  periodLabel: string;
  dueOn: string | null;
  kind: 'quarter' | 'month';
  permanentExtension: boolean;
  resultCents: number;
  lastFiling: Pick<VatFilingView, 'id' | 'filedOn' | 'reportId' | 'documents'> | null;
  amendmentDue: boolean;
  /** Die Nachzahlung einer offenen Berichtigung aus dem Dienst (`listVatPeriods`, 345). */
  amendmentPayment?: VatAmendmentPayment | null;
  /** Die Werte von heute sind festgeschrieben. */
  finalized: boolean;
  canEdit: boolean;
  /** Ein Dokument aus der Akte wählen (`dms.view`); sonst nur hochladen. */
  canPickDocument?: boolean;
  today: string;
}) {
  const t = useTranslations('finance.vat.filing');
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  // Welche Zeile gerade abgelegt wird; die Fassung erst mit festgeschriebener Fassung, das Protokoll nach der Abgabe (17a).
  const [filingSlot, setFilingSlot] = useState<'filedReturn' | 'transmissionProtocol' | null>(null);
  const doc = (slot: 'filedReturn' | 'transmissionProtocol'): RequirementListItem => {
    const filed = lastFiling?.documents[slot];
    // Die abgegebene Fassung gibt es erst mit einer festgeschriebenen Fassung (Joe 2026-10-25, Frage 1).
    const waiting = !filed && slot === 'filedReturn' && !lastFiling?.reportId;
    // Vor dem Festschreiben warten beide Zeilen (Designer Runde 8, 9a A): die Fassung „nach dem Festschreiben“, das
    // Protokoll „nach der Abgabe“ — kein Satz, der auf einen anderen Knopf zeigt.
    const protocolWaiting = !filed && slot === 'transmissionProtocol' && !lastFiling;
    return {
      key: slot,
      title: t(`documents.${slot}`),
      done: Boolean(filed),
      blocked: waiting || protocolWaiting,
      blockedText: protocolWaiting ? t('afterFiling') : t('afterFinalize'),
      // 17a: erledigt steht das Datum in `muted` hinter dem Titel.
      detail: lastFiling && filed ? fmt.date(lastFiling.filedOn) : undefined,
      canSelf: canEdit,
      canDoNames: [],
      canDoText: '',
      href: null,
      actionLabel: t('edit'),
      doneLabel: t('done'),
      extra: filed ? (
        <Link href={`/dms/${filed.documentId}`} className={`${linkClass} whitespace-nowrap font-mono`} data-testid={`vat-doc-${slot}`}>
          {filed.documentNumber}
        </Link>
      ) : lastFiling && canEdit && !waiting ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setFilingSlot(slot)} data-testid={`vat-file-${slot}`}>
          {t('file')}
        </Button>
      ) : undefined,
    };
  };
  const items = [doc('filedReturn'), doc('transmissionProtocol')];
  // Nach dem Festschreiben ist die berichtigte Fassung eine neue Abgabe hinter „Bearbeiten …“ — der Satz sagt das, statt die Zeile stumm stehen zu lassen.
  if (amendmentDue) items.push({ key: 'amended', title: t('documents.amended'), done: false, blocked: !finalized, blockedText: t('afterFinalize'), detail: finalized ? t('amendedHint') : undefined, canSelf: canEdit, canDoNames: [], canDoText: '', href: null, actionLabel: t('edit'), doneLabel: t('done') });
  // Vor dem Ende des Zeitraums lehnt der Dienst die Abgabe ab: kein „Bearbeiten …“, stattdessen der Tag (Befund 33).
  const opensOn = vatFilingOpensOn(periodKey);
  const notYet = !lastFiling && opensOn !== null && today < opensOn;
  const overdue = !lastFiling && dueOn !== null && dueOn < today;
  const editing = lastFiling && !amendmentDue ? { id: lastFiling.id, filedOn: lastFiling.filedOn } : null;
  return (
    <FormCard as="section" data-testid="vat-filing">
      <FormCardBody>
        <Section
          title={t('title')}
          actions={
            canEdit && !notYet ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="vat-filing-edit">
                {t('edit')}
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4">
            <FormGrid>
              {/* Designer Runde 8, 9a: Bei offener Berichtigung ist die Frist „unverzüglich“ wie unter Fristen, ist sie
                  verstrichen, steht die Marke „überfällig“ dahinter; „Zu zahlen“ ist dann die Nachzahlung mit der Rechnung. */}
              <FixedValue
                id="vat-due"
                label={t('dueOn')}
                value={
                  amendmentDue ? (
                    <span className="font-semibold text-warning">{t('immediately')}</span>
                  ) : dueOn && overdue ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {fmt.date(dueOn)}
                      <StatusBadge tone="warning" dot testId="vat-overdue">
                        {t('overdue')}
                      </StatusBadge>
                    </span>
                  ) : dueOn ? (
                    fmt.date(dueOn)
                  ) : null
                }
                reason={amendmentDue ? t('amendmentHint') : t('dueHint', { kind, extension: String(permanentExtension) })}
                size="s"
                className={TIGHT}
              />
              <FixedValue id="vat-filed" label={t('filedOn')} value={lastFiling ? fmt.date(lastFiling.filedOn) : null} reason={lastFiling ? (amendmentDue ? t('filedVersion', { first: String(amendmentPayment?.first ?? true) }) : undefined) : notYet ? t('filedFrom', { date: fmt.date(opensOn!) }) : t('filedReason')} size="s" testId="vat-filed" className={TIGHT} />
              {amendmentPayment ? (
                <FixedValue
                  id="vat-payable"
                  label={t('payable')}
                  value={formatEuro(amendmentPayment.payableCents)}
                  reason={t('amendmentPayable', { amended: formatEuro(amendmentPayment.amendedCents), filed: formatEuro(amendmentPayment.filedCents), first: String(amendmentPayment.first), date: fmt.date(amendmentPayment.filedOn) })}
                  size="s"
                  testId="vat-payable"
                  className={TIGHT}
                />
              ) : (
                <FixedValue id="vat-payable" label={t('payable')} value={formatEuro(resultCents)} reason={resultCents < 0 ? t('surplus') : t('payableHint')} size="s" testId="vat-payable" className={TIGHT} />
              )}
            </FormGrid>
            <RequirementList variant="rows" items={items} />
          </div>
        </Section>
      </FormCardBody>
      {canEdit ? <VatDialog open={open} onOpenChange={setOpen} period={periodKey} label={periodLabel} today={today} filing={editing} /> : null}
      {canEdit && lastFiling ? (
        <FilingDocumentDialog
          open={filingSlot !== null}
          onOpenChange={(open) => !open && setFilingSlot(null)}
          title={t('documentDialog.title', { slot: filingSlot ?? 'filedReturn' })}
          description={t('documentDialog.description', { period: periodLabel })}
          upload={(formData) => {
            formData.append('filingId', lastFiling.id);
            formData.append('slot', filingSlot ?? 'filedReturn');
            return fileVatFilingDocumentAction(formData);
          }}
          link={(documentId) => linkVatFilingDocumentAction({ filingId: lastFiling.id, slot: filingSlot ?? 'filedReturn', documentId })}
          canPickDocument={canPickDocument}
          testId="vat-document-dialog"
        />
      ) : null}
    </FormCard>
  );
}
