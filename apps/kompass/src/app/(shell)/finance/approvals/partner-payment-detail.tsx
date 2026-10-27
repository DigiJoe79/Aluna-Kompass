'use client';

import type { PartnerPaymentView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Notice } from '@/components/notice';
import { useDateFormat } from '@/components/date-format-provider';
import { ApprovalDetailFrame, type ApprovalFooter } from '@/components/finance/approval-detail-frame';
import { PartnerReasonPrompt, type PartnerReasonNeeds } from '@/components/finance/partner-reason-prompt';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { evidenceKindLabelKey, missingEvidence, type EvidenceKind, type PartnerBasis } from '@/lib/finance/partners';
import { approvePartnerPaymentAction, rejectPartnerPaymentAction } from '../partners/actions';
import { RejectDialog } from './reject-dialog';
import { Section } from '@/components/section';
import { FormCard, FormCardBody } from '@/components/forms/form-card';

interface EvidenceRow { kind: string; documentId: string | null; foreignLanguage: boolean; explanationDe: string | null; coveredCents: number | null }

/**
 * Die gemeinsame Detailansicht für eine Zahlung an Partner (F7 Task 6b,
 * Design-Nachtrag Phase 4 Task 3): `ApprovalDetailFrame` wie Auslage und
 * „Zweck ändern“ — die Art umrandet, an Stelle der Positionen die
 * Pflichtnachweise der Art (bei einem Auftrag: „Freigabe nur mit dem
 * Auftrag“), die Pflichtbegründungen schon vorab, in der klebenden Fußleiste
 * der Satz, was nach der Freigabe passiert. Ablehnen im Dialog mit
 * Pflichtgrund. `?payment=` wählt.
 */
export function PartnerPaymentDetail({ payment, creatorName, evidence, nextHref }: { payment: PartnerPaymentView; creatorName: string; evidence: EvidenceRow[]; nextHref: string | null }) {
  const t = useTranslations('finance.approvals');
  const tPartner = useTranslations('finance.partners.payment');
  const tBasis = useTranslations('finance.partners.basis');
  const fmt = useDateFormat();
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reasonNeeds, setReasonNeeds] = useState<PartnerReasonNeeds>({ notice: payment.reasonsNeeded.notice, overdue: payment.reasonsNeeded.overdue, purpose: payment.reasonsNeeded.purpose });
  const [noticeReason, setNoticeReason] = useState('');
  const [overdueReason, setOverdueReason] = useState('');
  // Q Rest: der Bestand eines Zwecks kann sich seit dem Einreichen geändert haben — vorab gefragt (`reasonsNeeded.purpose`) oder nach der Ablehnung.
  const [purposeReason, setPurposeReason] = useState('');
  const [purposeDetail, setPurposeDetail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Prüfer-Fixrunde 28.09.: eine Ablehnung in der Fehlerbox, mehrere Gründe als Liste — nicht als Toast.
  const [refusal, setRefusal] = useState<{ message: string; reasons?: string[] } | null>(null);
  const detailHref = `/finance/partners/${payment.partnerId}/payments/${payment.id}`;

  if (payment.state !== 'submitted') {
    const approved = payment.state === 'approved';
    return (
      <section data-testid="partner-payment-result" aria-live="polite" className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-section">{payment.number}</span>
          <StatusBadge tone={statusTone('decision', approved ? 'approved' : 'rejected')}>{approved ? t('partnerResult.approved') : t('partnerResult.rejected')}</StatusBadge>
        </div>
        <p className="text-figure font-semibold tabular-nums">{formatEuro(payment.totalCents)}</p>
        <p className="text-body text-ink">{payment.partnerName}</p>
        {!approved && payment.rejectNote ? <p className="text-body text-ink-2">{payment.rejectNote}</p> : null}
        <Link href={detailHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tPartner('back')}
        </Link>
        <div className="border-t border-line pt-3">
          {nextHref ? (
            <Link href={nextHref} className={buttonVariants({ variant: 'default' })}>
              {t('partnerResult.next')}
            </Link>
          ) : (
            <p className="text-meta text-muted-ink">{t('partnerResult.none')}</p>
          )}
        </div>
      </section>
    );
  }

  const basis = payment.basis as PartnerBasis;
  const required = payment.requiredEvidenceKinds as EvidenceKind[];
  const missing = missingEvidence(required, evidence.map((e) => ({ ...e, kind: e.kind as EvidenceKind })));
  const items: RequirementListItem[] = required.map((kind) => {
    const done = !missing.missingKinds.includes(kind);
    // Vor der Freigabe zählt nur der Auftrag je Vorhaben (bzw. die Vereinbarung) — der Rest kommt nach der Zahlung, bis zur Nachweisfrist.
    const beforeApproval = kind === 'agreement';
    return {
      key: kind,
      title: tPartner(`requiredEvidence.kind.${evidenceKindLabelKey(kind, basis)}`),
      done,
      blocked: !done && !beforeApproval,
      blockedText: t('partnerRequirements.later'),
      detail: done ? t('partnerRequirements.present') : undefined,
      canSelf: false,
      canDoNames: [],
      canDoText: '',
      href: '',
      actionLabel: t('partnerRequirements.missing'),
      doneLabel: t('partnerRequirements.done'),
    };
  });

  const approve = async () => {
    setPending(true);
    const result = await approvePartnerPaymentAction(payment.id, payment.version, noticeReason || undefined, overdueReason || undefined, purposeReason || undefined);
    setPending(false);
    if (result.status === 'error') {
      if (result.code === 'partnerNoticeReasonRequired') {
        setReasonNeeds((prev) => ({ ...prev, notice: true }));
        return;
      }
      if (result.code === 'partnerOverdueReasonRequired') {
        setReasonNeeds((prev) => ({ ...prev, overdue: true }));
        return;
      }
      if (result.code === 'purposeGoesNegative') {
        setReasonNeeds((prev) => ({ ...prev, purpose: true }));
        setPurposeDetail(result.detail ?? result.message);
        return;
      }
      setRefusal({ message: result.message, reasons: result.reasons });
      return;
    }
    setRefusal(null);
    toast.success(result.status === 'success' ? result.message ?? '' : '');
    router.refresh();
  };

  // Designer Runde 8, Frage 3.1 (wie 17b): eine Karte mit Zeilen statt einer Karte je Nachweis; die Zählung steht im
  // Kopf, der Hinweis als Unterzeile.
  const doneCount = items.filter((i) => i.done).length;
  const requirements = (
    <FormCard as="section" data-testid="partner-payment-requirements">
      <FormCardBody>
      <Section
        title={tPartner('requiredEvidence.title')}
        intro={basis === 'agent57' ? tPartner('requiredEvidence.agentNote') : tPartner('requiredEvidence.foreignNote')}
        actions={<span className="text-meta text-muted-ink">{tPartner('evidence.count', { done: doneCount, total: items.length, complete: doneCount === items.length ? 'yes' : 'no', extra: 0 })}</span>}
      >
        <div className="space-y-3">
          <RequirementList variant="rows" items={items} />
          <PartnerReasonPrompt needs={reasonNeeds} noticeReason={noticeReason} overdueReason={overdueReason} onNoticeReason={setNoticeReason} onOverdueReason={setOverdueReason} noticeValidUntil={payment.reasonsNeeded.noticeValidUntil} purposeReason={purposeReason} onPurposeReason={setPurposeReason} purposeDetail={purposeDetail ?? t('purposeReason.hint')} />
        </div>
      </Section>
      </FormCardBody>
    </FormCard>
  );

  const footer: ApprovalFooter = {
    state: refusal ? { status: 'error', message: refusal.message, reasons: refusal.reasons, title: t('footer.refused'), fieldErrors: {} } : undefined,
    note: (
      <>
        <p data-testid="partner-payment-after">
          {payment.retroactive
            ? t('partnerFooter.retroactive', { count: payment.effectiveProofMonths })
            : t('partnerFooter.payable', { name: payment.partnerName, amount: formatEuro(payment.totalCents), count: payment.effectiveProofMonths })}
        </p>
        <p className="text-hint text-muted-ink">{t('footer.humanOnly')}</p>
      </>
    ),
    reject: (
      <Button type="button" variant="outline" onClick={() => setRejecting(true)} data-testid="partner-payment-reject">
        {t('partnerReject.trigger')}
      </Button>
    ),
    approve: { label: t('partnerApprove.trigger'), pending, onClick: () => void approve(), testId: 'partner-payment-approve' },
  };

  return (
    <>
      <ApprovalDetailFrame
        head={{
          kind: t('kind.partnerPayment'),
          number: payment.number,
          numberMissing: t('partnerNoNumber'),
          amount: formatEuro(payment.totalCents),
          person: payment.partnerName,
          received: t('head.receivedAt', { at: payment.submittedAt ? fmt.dateTime(payment.submittedAt) : '' }),
          note: t('partnerCreatedBy', { name: creatorName }),
        }}
        requirements={requirements}
        footer={footer}
      >
        <div className="space-y-2" data-testid="partner-payment-detail">
          <p className="flex flex-wrap items-center gap-2" data-testid="partner-payment-basis">
            <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-hint font-semibold text-ink-2">{tBasis(basis)}</span>
            {payment.retroactive ? <StatusBadge tone="warning">{t('partnerRetroactive')}</StatusBadge> : null}
          </p>
          <p className="text-body text-ink">{payment.purposeText}</p>
          {payment.basisOverridden && payment.basisOverrideReason ? <p className="text-meta text-ink-2">{t('partnerOverride', { reason: payment.basisOverrideReason })}</p> : null}
          <Link href={detailHref} className="text-meta text-link underline">
            {tPartner('back')}
          </Link>
        </div>
      </ApprovalDetailFrame>
      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        number={payment.number ?? ''}
        person={creatorName}
        title={t('partnerReject.title', { name: payment.partnerName })}
        who={t('partnerReject.who', { name: creatorName })}
        onReject={(note) => rejectPartnerPaymentAction(payment.id, note)}
      />
    </>
  );
}
