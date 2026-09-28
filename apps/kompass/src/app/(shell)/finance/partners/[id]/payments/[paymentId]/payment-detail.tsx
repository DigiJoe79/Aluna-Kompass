'use client';

import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { BlockedState } from '@/components/blocked-state';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { LimitProgress } from '@/components/finance/limit-progress';
import { Notice } from '@/components/notice';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { GuidedSteps, guidedSteps } from '@/components/guided-steps';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { AMOUNT_EVIDENCE_KINDS, coverageRequired, evidenceCoverage, evidenceKindLabelKey, missingEvidence, type EvidenceKind, type PartnerBasis } from '@/lib/finance/partners';
import { acknowledgeEvidenceAction, addEvidenceLinkAction, addEvidenceUploadAction, copyPartnerPaymentAction, removeEvidenceAction, updateEvidenceAction } from '../../../actions';
import { DraftForm, type LineOption } from './draft-form';

interface Option { id: string; label: string }
export interface EvidenceRow {
  id: string;
  kind: string;
  documentId: string | null;
  foreignLanguage: boolean;
  explanationDe: string | null;
  coveredCents: number | null;
  /** Nummer und Betreff, soweit die Akte sie zeigt; `null` ohne Zugriff. */
  document: { number: string | null; subject: string } | null;
}
export interface PaymentPeople {
  creator: string;
  approver: string | null;
  acknowledger: string | null;
  /** Wer anerkennen kann: Recht „Freigeben“, ohne die anlegende Person. */
  acknowledgers: string[];
  viewerIsCreator: boolean;
}

const STEP_KEYS = ['draft', 'submitted', 'approved', 'paid', 'acknowledged'] as const;
/** V (Prüfer Block 2): nur die Abrechnung mit Belegen eines Auftrags trägt einen Betrag. */
const AMOUNT_KINDS: readonly string[] = AMOUNT_EVIDENCE_KINDS;

export function PaymentDetail({
  payment,
  partner,
  canWrite,
  canApprove,
  categories,
  purposes,
  projects,
  paidLineOptions,
  goodsLineOptions,
  evidence,
  agreementDocument,
  today,
  people,
}: {
  payment: PartnerPaymentView;
  partner: PartnerView;
  canWrite: boolean;
  canApprove: boolean;
  categories: Option[];
  purposes: Option[];
  projects: { id: string; name: string }[];
  paidLineOptions: LineOption[];
  goodsLineOptions: LineOption[];
  evidence: EvidenceRow[];
  agreementDocument: PickedDocument | null;
  today: string;
  people: PaymentPeople;
}) {
  const t = useTranslations('finance.partners.payment');
  const tBasis = useTranslations('finance.partners.basis');
  const fmt = useDateFormat();
  const router = useRouter();

  if (payment.state === 'draft') {
    return <DraftForm payment={payment} partner={partner} canWrite={canWrite} categories={categories} purposes={purposes} projects={projects} paidLineOptions={paidLineOptions} goodsLineOptions={goodsLineOptions} agreementDocument={agreementDocument} today={today} />;
  }

  const basis = payment.basis as PartnerBasis;
  const detail = (at: string | null, name: string | null) => (at ? [fmt.date(at.slice(0, 10)), name].filter(Boolean).join(' · ') : undefined);
  const stepDetail: Record<(typeof STEP_KEYS)[number], string | undefined> = {
    draft: detail(payment.createdAt, people.creator),
    submitted: detail(payment.submittedAt, null),
    approved: detail(payment.approvedAt, people.approver),
    paid: payment.paidOn ? fmt.date(payment.paidOn) : undefined,
    acknowledged: detail(payment.acknowledgedAt, people.acknowledger),
  };
  const steps = payment.activeStep ? guidedSteps(STEP_KEYS.map((key) => ({ key, label: t(`steps.${key}`), detail: stepDetail[key] })), payment.activeStep) : null;
  const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));
  const purposeLabel = new Map(purposes.map((p) => [p.id, p.label]));

  return (
    <div className="space-y-6" data-testid="payment-detail">
      {steps ? <GuidedSteps steps={steps} label={t('steps.label')} /> : null}
      <section className="space-y-2 rounded-md border border-line bg-surface p-4" data-testid="payment-head">
        <p className="text-[14px] font-semibold text-ink">
          {payment.proofDueOn
            ? t('head.withDue', { basis: tBasis(basis), amount: formatEuro(payment.totalCents), date: fmt.date(payment.proofDueOn) })
            : t('head.withMonths', { basis: tBasis(basis), amount: formatEuro(payment.totalCents), count: payment.effectiveProofMonths })}
        </p>
        <p className="text-[14px] text-ink-2">{payment.purposeText}</p>
        {payment.retroactive ? <p className="text-[12px] text-muted-ink">{t('head.retroactive')}</p> : null}
        <ul className="space-y-1 border-t border-line pt-2 text-[13px]" data-testid="payment-positions">
          {payment.positions.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-ink-2">
                {p.kind === 'money' ? t('positions.money') : t('positions.goods')}
                {p.categoryId && categoryLabel.get(p.categoryId) ? ` · ${categoryLabel.get(p.categoryId)}` : ''}
                {p.kind === 'money' ? ` · ${t('positions.paidFrom')} ${p.purposeId ? purposeLabel.get(p.purposeId) ?? '' : t('positions.freeFunds')}` : ''}
              </span>
              <span className="font-mono tabular-nums text-ink">{formatEuro(p.amountCents)}</span>
            </li>
          ))}
        </ul>
        {payment.rejectNote ? (
          <p className="text-[13px] text-error" data-testid="reject-note">
            {payment.rejectNote}
          </p>
        ) : null}
        {payment.state === 'rejected' && canWrite ? (
          <Button
            type="button"
            variant="secondary"
            data-testid="payment-copy"
            onClick={async () => {
              const result = await copyPartnerPaymentAction(payment.id);
              if (result.status !== 'success') {
                if (result.status === 'error') toast.error(result.message);
                return;
              }
              const data = result.data as { id: string; partnerId: string } | undefined;
              if (data) router.push(`/finance/partners/${data.partnerId}/payments/${data.id}`);
            }}
          >
            {t('copy')}
          </Button>
        ) : null}
      </section>

      {payment.state !== 'rejected' ? <EvidenceSection payment={payment} basis={basis} canWrite={canWrite} canApprove={canApprove} evidence={evidence} people={people} /> : null}
    </div>
  );
}

/** Ist die Pflichtart erfüllt (Annahme 11): echtes Dokument, bei Fremdsprache mit Erläuterung, bei Betragsarten mit Betrag. */
function kindDone(kind: string, rows: readonly EvidenceRow[]): boolean {
  return rows.some((e) => e.documentId !== null && (!e.foreignLanguage || !!e.explanationDe) && (!AMOUNT_KINDS.includes(kind) || e.coveredCents !== null));
}

function EvidenceSection({ payment, basis, canWrite, canApprove, evidence, people }: { payment: PartnerPaymentView; basis: PartnerBasis; canWrite: boolean; canApprove: boolean; evidence: EvidenceRow[]; people: PaymentPeople }) {
  const t = useTranslations('finance.partners.payment');
  const router = useRouter();
  const [openKind, setOpenKind] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const acknowledged = !!payment.acknowledgedAt;
  const editable = canWrite && !acknowledged;

  const required = payment.requiredEvidenceKinds as EvidenceKind[];
  const extraKinds = [...new Set(evidence.map((e) => e.kind))].filter((k) => !required.includes(k as EvidenceKind));
  const label = (kind: string) => t(`requiredEvidence.kind.${evidenceKindLabelKey(kind as EvidenceKind, basis)}`);
  const rowsOf = (kind: string) => evidence.filter((e) => e.kind === kind && e.documentId !== null);

  const describe = (kind: string): string | undefined => {
    const rows = rowsOf(kind);
    if (rows.length === 0) return undefined;
    return rows
      .map((e) =>
        [
          // AO (Recheck sha-0170e73): die Nummer steht als Link daneben (bzw. der Betreff, wo keine Nummer ist) — im Text nur einmal nennen.
          e.document ? (e.document.number ? e.document.subject : null) : t('evidence.documentHidden'),
          e.foreignLanguage ? (e.explanationDe ? t('evidence.explanationShort', { text: e.explanationDe }) : t('evidence.missingExplanation')) : null,
          AMOUNT_KINDS.includes(kind) ? (e.coveredCents !== null ? formatEuro(e.coveredCents) : t('evidence.missingAmount')) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      )
      .join(' — ');
  };

  const remove = async (kind: string) => {
    const last = rowsOf(kind).at(-1);
    if (!last) return;
    const result = await removeEvidenceAction(last.id);
    if (result.status === 'error') toast.error(result.message);
    else router.refresh();
  };

  const items: RequirementListItem[] = [...required, ...extraKinds].map((kind) => {
    const rows = rowsOf(kind);
    const incomplete = rows.find((e) => (e.foreignLanguage && !e.explanationDe) || (AMOUNT_KINDS.includes(kind) && e.coveredCents === null));
    const optional = !required.includes(kind as EvidenceKind);
    return {
      key: kind,
      title: optional ? `${label(kind)} (${t('evidence.optional')})` : label(kind),
      done: kindDone(kind, rows),
      blocked: false,
      detail: describe(kind),
      canSelf: false,
      canDoNames: [],
      canDoText: '',
      href: '',
      actionLabel: t('evidence.addOrLink'),
      doneLabel: t('evidence.done'),
      extra: (
        <span className="flex flex-wrap items-center gap-2">
          {/* W (Prüfer Block 2): jeder Nachweis mit Nummer und Link auf das PDF — auch für Leser, soweit die Akte es zeigt. */}
          {rows.map((e) =>
            e.document && e.documentId ? (
              <a key={e.id} href={`/dms/${e.documentId}/file`} target="_blank" rel="noreferrer" className="font-mono text-[12px] font-semibold underline underline-offset-2" data-testid={`evidence-document-${e.id}`}>
                {e.document.number ?? e.document.subject}
              </a>
            ) : null,
          )}
          {editable ? (
            <>
          {incomplete ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setCompleting(incomplete.id)}>
              {t('evidence.complete')}
            </Button>
          ) : null}
          {rows.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" aria-label={t('evidence.removeKind', { kind: label(kind) })} onClick={() => void remove(kind)}>
              {t('evidence.remove')}
            </Button>
          ) : null}
          <Button type="button" variant={rows.length === 0 ? 'default' : 'outline'} size="sm" onClick={() => setOpenKind(kind)}>
            {t('evidence.addOrLink')}
          </Button>
            </>
          ) : null}
        </span>
      ),
    };
  });

  const evidenceRows = evidence.map((e) => ({ kind: e.kind as EvidenceKind, documentId: e.documentId, foreignLanguage: e.foreignLanguage, explanationDe: e.explanationDe, coveredCents: e.coveredCents }));
  const missing = missingEvidence(required, evidenceRows);
  const needsCoverage = coverageRequired(required);
  const coverage = evidenceCoverage(evidenceRows, payment.totalCents);
  const paid = payment.activeStep === 'paid';
  const ready = paid && missing.missingKinds.length === 0 && missing.missingExplanation.length === 0 && missing.missingAmount.length === 0 && (!needsCoverage || coverage.complete);
  const rest = Math.max(0, coverage.totalCents - coverage.coveredCents);

  const acknowledge = async () => {
    const result = await acknowledgeEvidenceAction(payment.id);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  // AM (Recheck sha-0170e73): Eine Sperre am Recht nennt, wer es kann; eine Sperre am Zustand (Zahlung, Nachweise) nennt, was sie löst — nie Personen.
  const block: { reason: string; byRight: boolean } | null = people.viewerIsCreator
    ? { reason: t('acknowledge.blockedOwn'), byRight: true }
    : !canApprove
      ? { reason: t('acknowledge.blockedRight'), byRight: true }
      : !paid
        ? { reason: t('acknowledge.blockedUnpaid', { number: payment.number ?? '' }), byRight: false }
        : !ready
          ? { reason: t('acknowledge.blockedMissing', { coverage: needsCoverage ? 'yes' : 'no' }), byRight: false }
          : null;

  return (
    <section className="space-y-3" data-testid="evidence-section">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-[16px] text-ink">{t('evidence.title')}</h2>
        <span className="text-[13px] text-muted-ink">{t('evidence.count', { done: required.filter((k) => kindDone(k, rowsOf(k))).length, total: required.length })}</span>
      </div>
      <div data-testid="evidence-requirements">
        <RequirementList items={items} />
      </div>
      {openKind ? <EvidenceForm key={openKind} paymentId={payment.id} kind={openKind} label={label(openKind)} onDone={() => { setOpenKind(null); router.refresh(); }} onCancel={() => setOpenKind(null)} /> : null}
      {completing ? <CompleteForm key={completing} row={evidence.find((e) => e.id === completing)!} onDone={() => { setCompleting(null); router.refresh(); }} onCancel={() => setCompleting(null)} /> : null}
      <p className="text-[12px] text-muted-ink">{t('evidence.foreignHint')}</p>

      {needsCoverage && coverage.totalCents > 0 ? (
        <div data-testid="evidence-coverage" aria-live="polite">
          <LimitProgress
            coveredCents={coverage.coveredCents}
            totalCents={coverage.totalCents}
            label={t('evidence.coverageLabel')}
            figure={t('evidence.coverageFigure', { covered: formatEuro(coverage.coveredCents), total: formatEuro(coverage.totalCents) })}
            remainder={rest > 0 ? t('evidence.coverageRest', { rest: formatEuro(rest) }) : t('evidence.coverageDone')}
          />
        </div>
      ) : null}

      <div className="space-y-2" data-testid="evidence-acknowledge-area">
        {acknowledged ? (
          <p className="text-[13px] text-success" data-testid="evidence-acknowledged">
            {t('evidence.acknowledged')}
          </p>
        ) : (
          <>
            {payment.readyToAcknowledge ? (
              <div data-testid="payment-ready-to-acknowledge">
                <Notice level="hint">{t('acknowledge.ready')}</Notice>
              </div>
            ) : null}
            <p className="text-[13px] text-ink-2">{t('acknowledge.rule', { creator: people.creator, coverage: needsCoverage ? 'yes' : 'no' })}</p>
            {block ? (
              <BlockedState step={t('evidence.acknowledge')} title={t('acknowledge.blockedTitle')}>
                {block.reason}
                {block.byRight ? ` ${people.acknowledgers.length > 0 ? t('acknowledge.canDo', { names: people.acknowledgers.join(', ') }) : t('acknowledge.nobody')}` : null}
              </BlockedState>
            ) : (
              <Button type="button" data-testid="evidence-acknowledge" onClick={() => void acknowledge()}>
                {t('evidence.acknowledge')}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** „Hochladen oder verknüpfen“ für eine Nachweisart (Artboard 4b): PDF ablegen oder aus der Akte wählen, Erläuterung und Betrag am Nachweis. */
function EvidenceForm({ paymentId, kind, label, onDone, onCancel }: { paymentId: string; kind: string; label: string; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('finance.partners.payment');
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PickedDocument | null>(null);
  const [fromArchive, setFromArchive] = useState(false);
  const [foreignLanguage, setForeignLanguage] = useState(false);
  const [explanationDe, setExplanationDe] = useState('');
  const [amountText, setAmountText] = useState('');
  const [pending, setPending] = useState(false);
  const withAmount = AMOUNT_KINDS.includes(kind);

  const save = async () => {
    setPending(true);
    const coveredCents = withAmount ? parseAmount(amountText) : null;
    let result;
    if (file) {
      const formData = new FormData();
      formData.append('paymentId', paymentId);
      formData.append('kind', kind);
      formData.append('foreignLanguage', foreignLanguage ? 'on' : 'off');
      formData.append('explanationDe', explanationDe);
      formData.append('coveredCents', coveredCents === null ? '' : String(coveredCents / 100));
      formData.append('file', file);
      result = await addEvidenceUploadAction(formData);
    } else if (document) {
      result = await addEvidenceLinkAction({ paymentId, kind, documentId: document.id, foreignLanguage, explanationDe: explanationDe || undefined, coveredCents: coveredCents ?? undefined });
    } else {
      setPending(false);
      return;
    }
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-3" data-testid={`evidence-form-${kind}`}>
      <p className="text-[14px] font-semibold text-ink">{label}</p>
      {fromArchive ? (
        <DocumentPicker id={`evidence-document-${kind}`} name="documentId" label={t('evidence.link')} value={document} onChange={setDocument} />
      ) : (
        <ReceiptDrop onFiles={(files) => setFile(files[0] ?? null)} onPickFromArchive={() => setFromArchive(true)} />
      )}
      {file ? <p className="text-[12px] text-ink-2">{t('evidence.fileChosen', { name: file.name })}</p> : null}
      <label className="flex min-h-11 items-center gap-2 text-[13px]">
        <Checkbox checked={foreignLanguage} onCheckedChange={(v) => setForeignLanguage(v === true)} />
        {t('evidence.foreignLanguage')}
      </label>
      {foreignLanguage ? (
        <div className="space-y-1.5">
          <Label htmlFor={`evidence-explanation-${kind}`} required>
            {t('evidence.explanation')}
          </Label>
          <Textarea id={`evidence-explanation-${kind}`} rows={2} value={explanationDe} onChange={(e) => setExplanationDe(e.target.value)} />
        </div>
      ) : null}
      {withAmount ? (
        <div className="space-y-1.5">
          <Label htmlFor={`evidence-amount-${kind}`} required>
            {t('evidence.coveredAmount')}
          </Label>
          <AmountField id={`evidence-amount-${kind}`} name="coveredAmount" value={amountText} onChange={setAmountText} required />
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('evidence.cancel')}
        </Button>
        <Button type="button" disabled={pending || (!file && !document)} onClick={() => void save()} data-testid="evidence-save">
          {document && !file ? t('evidence.linkSave') : t('evidence.upload')}
        </Button>
      </div>
    </div>
  );
}

/** Erläuterung oder Betrag eines vorhandenen Nachweises ergänzen — bis zum Anerkennen. */
function CompleteForm({ row, onDone, onCancel }: { row: EvidenceRow; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('finance.partners.payment');
  const [explanationDe, setExplanationDe] = useState(row.explanationDe ?? '');
  const [amountText, setAmountText] = useState(row.coveredCents !== null ? (row.coveredCents / 100).toFixed(2).replace('.', ',') : '');
  const withAmount = AMOUNT_KINDS.includes(row.kind);
  const save = async () => {
    const result = await updateEvidenceAction({ id: row.id, ...(row.foreignLanguage ? { explanationDe } : {}), ...(withAmount ? { coveredCents: parseAmount(amountText) } : {}) });
    if (result.status === 'error') toast.error(result.message);
    else onDone();
  };
  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-3" data-testid="evidence-complete-form">
      {row.foreignLanguage ? (
        <div className="space-y-1.5">
          <Label htmlFor="evidence-complete-explanation" required>
            {t('evidence.explanation')}
          </Label>
          <Textarea id="evidence-complete-explanation" rows={2} value={explanationDe} onChange={(e) => setExplanationDe(e.target.value)} />
        </div>
      ) : null}
      {withAmount ? (
        <div className="space-y-1.5">
          <Label htmlFor="evidence-complete-amount" required>
            {t('evidence.coveredAmount')}
          </Label>
          <AmountField id="evidence-complete-amount" name="coveredAmount" value={amountText} onChange={setAmountText} required />
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('evidence.cancel')}
        </Button>
        <Button type="button" onClick={() => void save()}>
          {t('evidence.completeSave')}
        </Button>
      </div>
    </div>
  );
}
