'use client';

import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { PartnerReasonPrompt } from '@/components/finance/partner-reason-prompt';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { SaveStatus } from '@/components/forms/save-status';
import { StickyFooter } from '@/components/forms/sticky-footer';
import { useAutosave, type SaveOutcome } from '@/components/forms/use-autosave';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { evidenceKindLabelKey, proofDueDate, requiredEvidenceKinds, type PartnerBasis } from '@/lib/finance/partners';
import { cn } from '@/lib/utils';
import { deletePartnerPaymentDraftAction, savePartnerPaymentDraftAction, submitPartnerPaymentAction } from '../../../actions';

interface Option { id: string; label: string }
export interface LineOption { id: string; entryNumber: string | null; entryDate: string; amountCents: number; categoryId?: string }
interface PositionState { key: string; kind: 'money' | 'goods'; amountText: string; categoryId: string; purposeId: string; projectId: string; goodsLineId: string; note: string }

interface DraftState {
  version: string;
  purposeText: string;
  basis: PartnerBasis;
  basisOverrideReason: string;
  retroactive: boolean;
  agreementDocument: PickedDocument | null;
  positions: PositionState[];
  paidLineIds: string[];
  /** `null`: die übliche Frist des Partners. */
  proofMonths: number | null;
}

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const PROOF_MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);

function payloadOf(paymentId: string, partnerId: string, usualBasis: string | null, d: DraftState) {
  return {
    id: paymentId,
    expectedVersion: d.version,
    partnerId,
    basis: d.basis,
    basisOverrideReason: d.basis !== usualBasis ? d.basisOverrideReason || null : null,
    purposeText: d.purposeText,
    agreementDocumentId: d.agreementDocument?.id ?? null,
    retroactive: d.retroactive,
    proofMonths: d.proofMonths,
    positions: d.retroactive
      ? []
      : d.positions.map((p) => ({ kind: p.kind, amountCents: p.kind === 'money' ? (parseAmount(p.amountText) ?? 0) || undefined : undefined, categoryId: p.categoryId || undefined, purposeId: p.kind === 'money' ? p.purposeId || null : undefined, projectId: p.projectId || undefined, goodsLineId: p.kind === 'goods' ? p.goodsLineId || undefined : undefined, note: p.note || undefined })),
    paidLineIds: d.retroactive ? d.paidLineIds : [],
  };
}

/**
 * E2 Entwurf (Design-Nachtrag Phase 4, Artboard 4b): laufend gesichert wie D1
 * (`useAutosave`), die Art als Segment mit Herkunftssatz, darunter live
 * „Daraus folgen diese Nachweise“ (`aria-live`), die Warnungen vorab als
 * `Notice warn` mit eigener Pflichtbegründung, die Nachweisfrist in Monaten
 * und die klebende Fußleiste „Als Entwurf speichern · Zur Freigabe geben“.
 */
export function DraftForm({
  payment,
  partner,
  canWrite,
  categories,
  purposes,
  projects,
  paidLineOptions,
  goodsLineOptions,
  agreementDocument,
  today,
}: {
  payment: PartnerPaymentView;
  partner: PartnerView;
  canWrite: boolean;
  categories: Option[];
  purposes: Option[];
  projects: { id: string; name: string }[];
  paidLineOptions: LineOption[];
  goodsLineOptions: LineOption[];
  agreementDocument: PickedDocument | null;
  today: string;
}) {
  const t = useTranslations('finance.partners.payment');
  const tBasis = useTranslations('finance.partners.basis');
  const tStatus = useTranslations('finance.partners.status');
  const fmt = useDateFormat();
  const router = useRouter();
  const [reasonNeeds, setReasonNeeds] = useState({ notice: payment.reasonsNeeded.notice, overdue: payment.reasonsNeeded.overdue, purpose: payment.reasonsNeeded.purpose });
  // Befund Q: Begründung, wenn ein Zweck durch die Zahlung ins Minus ginge — mit dem Satz des Dienstes nach einer Ablehnung.
  const [purposeReason, setPurposeReason] = useState('');
  const [purposeDetail, setPurposeDetail] = useState<string | null>(null);
  const [noticeReason, setNoticeReason] = useState('');
  const [overdueReason, setOverdueReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useCallback(
    async (current: DraftState): Promise<SaveOutcome<DraftState>> => {
      const state: ActionState = await savePartnerPaymentDraftAction(payloadOf(payment.id, payment.partnerId, partner.usualBasis, current));
      if (state.status !== 'success') return { kind: 'failed', detail: state.status === 'error' ? state.message : '' };
      const view = state.data as PartnerPaymentView;
      // Vorab gemeldet: eine Warnung erscheint, sobald der Dienst sie kennt; eine schon gezeigte bleibt stehen, bis eingereicht ist.
      setReasonNeeds((prev) => ({ notice: prev.notice || view.reasonsNeeded.notice, overdue: prev.overdue || view.reasonsNeeded.overdue, purpose: view.reasonsNeeded.purpose }));
      return { kind: 'saved', at: view.version, apply: (latest) => ({ ...latest, version: view.version }) };
    },
    [payment.id, payment.partnerId, partner.usualBasis],
  );

  const initial: DraftState = {
    version: payment.version,
    purposeText: payment.purposeText,
    basis: payment.basis as PartnerBasis,
    basisOverrideReason: payment.basisOverrideReason ?? '',
    retroactive: payment.retroactive,
    agreementDocument,
    positions: payment.positions.map((p) => ({ key: newKey(), kind: p.kind, amountText: p.kind === 'money' ? (p.amountCents / 100).toFixed(2).replace('.', ',') : '', categoryId: p.categoryId ?? '', purposeId: p.purposeId ?? '', projectId: p.projectId ?? '', goodsLineId: p.goodsLineId ?? '', note: p.note ?? '' })),
    paidLineIds: payment.paidLines.map((l) => l.paidLineId),
    proofMonths: payment.proofMonths,
  };
  const { value: d, state: saveState, pending, update, flush, markDirty } = useAutosave<DraftState>({ initial, initialState: { kind: 'saved', at: payment.version }, save });

  const set = (patch: Partial<DraftState>) => update((prev) => ({ ...prev, ...patch }));
  const setPosition = (key: string, patch: Partial<PositionState>) => update((prev) => ({ ...prev, positions: prev.positions.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const addPosition = (kind: 'money' | 'goods') => update((prev) => ({ ...prev, positions: [...prev.positions, { key: newKey(), kind, amountText: '', categoryId: '', purposeId: '', projectId: '', goodsLineId: '', note: '' }] }));

  const overridden = partner.usualBasis !== null && d.basis !== partner.usualBasis;
  const hasGoods = !d.retroactive && d.positions.some((p) => p.kind === 'goods');
  const required = requiredEvidenceKinds({ basis: d.basis, partnerStatus: partner.status, hasGoodsPositions: hasGoods });
  const months = d.proofMonths ?? partner.usualProofMonths;
  const chosenLines = paidLineOptions.filter((l) => d.paidLineIds.includes(l.id)).concat(payment.paidLines.filter((l) => d.paidLineIds.includes(l.paidLineId) && !paidLineOptions.some((o) => o.id === l.paidLineId)).map((l) => ({ id: l.paidLineId, entryNumber: null, entryDate: l.entryDate, amountCents: l.amountCents })));
  const paymentDay = [...chosenLines].sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0]?.entryDate ?? today;
  const lineOptions = [...paidLineOptions, ...chosenLines.filter((l) => !paidLineOptions.some((o) => o.id === l.id))];

  const keepDraft = async () => {
    markDirty();
    const saved = await flush();
    if (saved) router.push(`/finance/partners/${payment.partnerId}`);
  };

  const submit = async () => {
    setBusy(true);
    try {
      markDirty();
      const saved = await flush();
      if (!saved) return;
      const result = await submitPartnerPaymentAction(payment.id, saved.version, noticeReason || undefined, overdueReason || undefined, purposeReason || undefined);
      if (result.status === 'error') {
        if (result.code === 'partnerNoticeReasonRequired') setReasonNeeds((prev) => ({ ...prev, notice: true }));
        else if (result.code === 'partnerOverdueReasonRequired') setReasonNeeds((prev) => ({ ...prev, overdue: true }));
        else if (result.code === 'purposeGoesNegative') {
          setReasonNeeds((prev) => ({ ...prev, purpose: true }));
          setPurposeDetail(result.detail ?? result.message);
        }
        else toast.error(result.message);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const basisOption = (basis: PartnerBasis) => (
    <label
      key={basis}
      className={cn(
        'relative flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-sm px-3 py-1.5 text-center text-[14px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        d.basis === basis ? 'bg-selected text-selected-ink' : 'text-ink-2',
      )}
    >
      <input type="radio" name="payment-basis" value={basis} checked={d.basis === basis} disabled={!canWrite} onChange={() => set({ basis })} className="absolute inset-0 cursor-pointer opacity-0" />
      {tBasis(basis)}
    </label>
  );

  return (
    <div className="space-y-6" data-testid="payment-draft-form">
      <div className="space-y-1.5">
        <Label htmlFor="payment-purpose" required>
          {t('purposeText')}
        </Label>
        <Textarea id="payment-purpose" rows={2} value={d.purposeText} disabled={!canWrite} onChange={(e) => set({ purposeText: e.target.value })} />
      </div>

      <div className="space-y-1.5" data-testid="payment-basis">
        <p id="payment-basis-label" className="text-sm font-medium">{t('basis')}</p>
        <div role="radiogroup" aria-labelledby="payment-basis-label" className="flex flex-col gap-1 rounded-md border border-line-strong bg-surface-2 p-1 sm:flex-row">
          {basisOption('transfer58')}
          {basisOption('agent57')}
        </div>
        {partner.usualBasis ? <p className="text-[12px] text-muted-ink">{t('basisFrom', { basis: tBasis(partner.usualBasis) })}</p> : null}
      </div>

      {overridden ? (
        <div data-testid="payment-basis-override">
          <Notice level="warn" reason={{ name: 'payment-basis-reason', value: d.basisOverrideReason, onChange: (value) => set({ basisOverrideReason: value }), label: t(`basisOverride.question.${d.basis}`) }}>
            {t('basisOverride.hint', { usual: tBasis(partner.usualBasis!) })}
          </Notice>
        </div>
      ) : null}

      <section className="space-y-2 rounded-md border border-line bg-surface p-4" data-testid="draft-required-evidence" aria-live="polite">
        <h2 className="text-[14px] font-semibold text-ink">{t('requiredEvidence.titleFor', { basis: tBasis(d.basis), status: tStatus(partner.status) })}</h2>
        <ul className="space-y-1.5">
          {required.map((kind) => (
            <li key={kind} className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
              <span>{t(`requiredEvidence.kind.${evidenceKindLabelKey(kind, d.basis)}`)}</span>
              {kind === 'agreement' && d.basis === 'agent57' ? <span className="text-[12px] text-muted-ink">— {t('requiredEvidence.agreementAgent57Hint')}</span> : null}
              <span className="rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{t('requiredEvidence.required')}</span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-muted-ink">{d.basis === 'agent57' ? t('requiredEvidence.agentNote') : t('requiredEvidence.foreignNote')}</p>
      </section>

      <PartnerReasonPrompt needs={reasonNeeds} noticeReason={noticeReason} overdueReason={overdueReason} onNoticeReason={setNoticeReason} onOverdueReason={setOverdueReason} purposeReason={purposeReason} onPurposeReason={setPurposeReason} purposeDetail={purposeDetail} noticeValidUntil={payment.reasonsNeeded.noticeValidUntil} />

      {d.basis === 'agent57' || partner.status === 'foreignBody' || d.agreementDocument ? (
        <DocumentPicker id="payment-agreement-doc" name="agreementDocumentId" label={t(`agreementDocumentFor.${d.basis}`)} value={d.agreementDocument} onChange={(doc) => set({ agreementDocument: doc })} required={d.basis === 'agent57' || partner.status === 'foreignBody'} />
      ) : null}

      <div className="space-y-2">
        <label className="flex min-h-11 items-center gap-2 text-[14px]" data-testid="payment-retroactive">
          <Checkbox checked={d.retroactive} disabled={!canWrite} onCheckedChange={(v) => set({ retroactive: v === true })} />
          {t('retroactive')}
        </label>
        {d.retroactive ? (
          <div data-testid="payment-retroactive-warn">
            <Notice level="warn">{t('retroactiveWarn')}</Notice>
          </div>
        ) : null}
      </div>

      {d.retroactive ? (
        <section className="space-y-2" data-testid="paid-line-picker">
          <h2 className="font-heading text-[15px] text-ink">{t('paidLines.title')}</h2>
          {lineOptions.length === 0 ? (
            <p className="text-[13px] text-muted-ink">{t('paidLines.empty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {lineOptions.map((line) => (
                <li key={line.id}>
                  <label className="flex min-h-11 items-center gap-2 text-[13px]">
                    <Checkbox
                      checked={d.paidLineIds.includes(line.id)}
                      disabled={!canWrite}
                      onCheckedChange={(v) => update((prev) => ({ ...prev, paidLineIds: v === true ? [...prev.paidLineIds, line.id] : prev.paidLineIds.filter((id) => id !== line.id) }))}
                    />
                    <span className="font-mono">
                      {line.entryNumber ? `${line.entryNumber} · ` : ''}
                      {fmt.date(line.entryDate)} · {formatEuro(Math.abs(line.amountCents))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="space-y-3" data-testid="position-rows">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-[15px] text-ink">{t('positions.title')}</h2>
            {canWrite ? (
              <span className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => addPosition('money')} data-testid="position-add-money">
                  {t('positions.add')} ({t('positions.money')})
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => addPosition('goods')} data-testid="position-add-goods">
                  {t('positions.add')} ({t('positions.goods')})
                </Button>
              </span>
            ) : null}
          </div>
          {d.positions.map((p) => (
            <div key={p.key} className="grid grid-cols-1 gap-2 rounded-md border border-line bg-surface p-3 sm:grid-cols-4" data-testid="position-row">
              <span className="text-[12px] font-semibold uppercase text-muted-ink sm:col-span-4">{p.kind === 'money' ? t('positions.money') : t('positions.goods')}</span>
              {p.kind === 'money' ? (
                <>
                  <Input aria-label={t('positions.amount')} inputMode="decimal" className="text-right tabular-nums" value={p.amountText} disabled={!canWrite} onChange={(e) => setPosition(p.key, { amountText: e.target.value })} placeholder={t('positions.amount')} />
                  <Select aria-label={t('positions.category')} value={p.categoryId} disabled={!canWrite} onChange={(e) => setPosition(p.key, { categoryId: e.target.value })}>
                    <option value="">{t('positions.category')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={t('positions.paidFrom')} value={p.purposeId} disabled={!canWrite} onChange={(e) => setPosition(p.key, { purposeId: e.target.value })}>
                    <option value="">{t('positions.freeFunds')}</option>
                    {purposes.map((pu) => (
                      <option key={pu.id} value={pu.id}>
                        {pu.label}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={t('positions.project')} value={p.projectId} disabled={!canWrite} onChange={(e) => setPosition(p.key, { projectId: e.target.value })}>
                    <option value="">{t('positions.project')}</option>
                    {projects.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                  </Select>
                </>
              ) : (
                <Select aria-label={t('positions.goodsLine')} value={p.goodsLineId} disabled={!canWrite} onChange={(e) => setPosition(p.key, { goodsLineId: e.target.value })} className="sm:col-span-3">
                  <option value="">{t('positions.goodsLine')}</option>
                  {goodsLineOptions.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.entryNumber ? `${line.entryNumber} · ` : ''}
                      {fmt.date(line.entryDate)} · {formatEuro(Math.abs(line.amountCents))}
                    </option>
                  ))}
                </Select>
              )}
              {canWrite ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => update((prev) => ({ ...prev, positions: prev.positions.filter((x) => x.key !== p.key) }))} data-testid="position-remove">
                  {t('positions.remove')}
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      )}

      <div className="space-y-1.5" data-testid="payment-proof">
        <Label htmlFor="payment-proof-months">{t('proof.label')}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Select id="payment-proof-months" className="w-auto" value={String(months)} disabled={!canWrite} onChange={(e) => set({ proofMonths: Number(e.target.value) === partner.usualProofMonths && d.proofMonths === null ? null : Number(e.target.value) })}>
            {PROOF_MONTHS.map((n) => (
              <option key={n} value={n}>
                {t('proof.months', { count: n })}
              </option>
            ))}
          </Select>
          {/* Task 6c (Joe 28.09.): die Frist läuft ab dem Zahlungstag — ein Datum gibt es erst, wenn er feststeht (nachträglich: die gewählte Zeile). */}
          {d.retroactive && chosenLines.length > 0 ? <span className="font-mono text-[14px] tabular-nums text-ink">{fmt.date(proofDueDate(paymentDay, months))}</span> : null}
        </div>
        <p className="text-[12px] text-muted-ink">{d.proofMonths === null ? t('proof.fromUsual', { count: partner.usualProofMonths }) : t('proof.own', { count: partner.usualProofMonths })}</p>
      </div>

      {canWrite ? (
        <StickyFooter testId="payment-footer">
          <SaveStatus state={saveState} pending={pending} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" className="text-error" data-testid="payment-delete-draft" onClick={() => setConfirmDelete(true)}>
              {t('deleteDraft')}
            </Button>
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void keepDraft()} data-testid="payment-save">
                {t('save')}
              </Button>
              <Button type="button" disabled={busy} onClick={() => void submit()} data-testid="payment-submit">
                {t('submit')}
              </Button>
            </div>
          </div>
        </StickyFooter>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('deleteDraftConfirm.title')}
        description={t('deleteDraftConfirm.description')}
        confirmLabel={t('deleteDraft')}
        destructive
        action={async () => {
          const result = await deletePartnerPaymentDraftAction(payment.id, payment.partnerId);
          if (result.status !== 'error') router.push(`/finance/partners/${payment.partnerId}`);
          return result;
        }}
      />
    </div>
  );
}
