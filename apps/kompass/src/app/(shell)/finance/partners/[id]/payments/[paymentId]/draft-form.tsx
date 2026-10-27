'use client';

import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { ChoiceCards } from '@/components/choice-cards';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { PartnerReasonPrompt } from '@/components/finance/partner-reason-prompt';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useAutosave, type SaveOutcome } from '@/components/forms/use-autosave';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { formatAmount, formatEuro, parseAmount } from '@/lib/finance/amount';
import { evidenceKindLabelKey, proofDueDate, requiredEvidenceKinds, type PartnerBasis } from '@/lib/finance/partners';
import { savePartnerPaymentDraftAction, submitPartnerPaymentAction } from '../../../actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';

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
  /** Vermögensausstattung nach § 58 Nr. 3 AO (Zeile 64/65 der Anlage Gem). */
  assetEndowment: boolean;
}

/** Wie der Dienst (`assetEndowmentAllowed`): nur Weitergabe nach § 58 Nr. 1 AO an eine steuerbegünstigte oder öffentliche Körperschaft. */
export const endowmentAllowed = (basis: string, status: string) => basis === 'transfer58' && (status === 'taxExemptBody' || status === 'publicBody');

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const PROOF_MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);

function payloadOf(paymentId: string, partnerId: string, usualBasis: string | null, d: DraftState, partnerStatus: string) {
  return {
    assetEndowment: d.assetEndowment && endowmentAllowed(d.basis, partnerStatus),
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
  const tDetail = useTranslations('finance.partners.detail');
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
  const [refusal, setRefusal] = useState<ActionState | null>(null);

  const save = useCallback(
    async (current: DraftState): Promise<SaveOutcome<DraftState>> => {
      const state: ActionState = await savePartnerPaymentDraftAction(payloadOf(payment.id, payment.partnerId, partner.usualBasis, current, partner.status));
      if (state.status !== 'success') return { kind: 'failed', detail: state.status === 'error' ? state.message : '' };
      const view = state.data as PartnerPaymentView;
      // Vorab gemeldet: eine Warnung erscheint, sobald der Dienst sie kennt; eine schon gezeigte bleibt stehen, bis eingereicht ist.
      setReasonNeeds((prev) => ({ notice: prev.notice || view.reasonsNeeded.notice, overdue: prev.overdue || view.reasonsNeeded.overdue, purpose: view.reasonsNeeded.purpose }));
      return { kind: 'saved', at: view.version, apply: (latest) => ({ ...latest, version: view.version }) };
    },
    [payment.id, payment.partnerId, partner.usualBasis, partner.status],
  );

  const initial: DraftState = {
    version: payment.version,
    purposeText: payment.purposeText,
    basis: payment.basis as PartnerBasis,
    basisOverrideReason: payment.basisOverrideReason ?? '',
    retroactive: payment.retroactive,
    agreementDocument,
    positions: payment.positions.map((p) => ({ key: newKey(), kind: p.kind, amountText: p.kind === 'money' ? formatAmount(p.amountCents) : '', categoryId: p.categoryId ?? '', purposeId: p.purposeId ?? '', projectId: p.projectId ?? '', goodsLineId: p.goodsLineId ?? '', note: p.note ?? '' })),
    paidLineIds: payment.paidLines.map((l) => l.paidLineId),
    proofMonths: payment.proofMonths,
    assetEndowment: payment.assetEndowment,
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
    setRefusal(null);
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
        else setRefusal(result);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="payment-draft-form">
      <FormGrid>
        <FormField id="payment-purpose" label={t('purposeText')} required size="l">
          <Textarea id="payment-purpose" rows={2} value={d.purposeText} disabled={!canWrite} onChange={(e) => set({ purposeText: e.target.value })} />
        </FormField>
      </FormGrid>

      {/* Art als ChoiceCards, weil die Optionen Sätze sind (Entscheidung zum Inventar § E); ohne Schreibrecht als Anzeige wie in den Angaben zum Partner. */}
      <div className="space-y-1.5" data-testid="payment-basis">
        {canWrite ? (
          <ChoiceCards
            mode="choice"
            name="payment-basis"
            legend={t('basis')}
            value={d.basis}
            onSelect={(v) => set({ basis: v as PartnerBasis })}
            options={(['transfer58', 'agent57'] as const).map((b) => ({ value: b, label: tDetail(`profile.basisCards.${b}`), description: tBasis(b) }))}
          />
        ) : (
          <div className="space-y-1">
            <p className="text-meta font-semibold text-ink">{t('basis')}</p>
            <p className="text-body text-ink-2">{tBasis(d.basis)}</p>
          </div>
        )}
        {partner.usualBasis ? <p className="text-hint text-muted-ink">{t('basisFrom', { basis: tBasis(partner.usualBasis) })}</p> : null}
      </div>

      {overridden ? (
        <div data-testid="payment-basis-override">
          <Notice level="warn" reason={{ name: 'payment-basis-reason', value: d.basisOverrideReason, onChange: (value) => set({ basisOverrideReason: value }), label: t(`basisOverride.question.${d.basis}`) }}>
            {t('basisOverride.hint', { usual: tBasis(partner.usualBasis!) })}
          </Notice>
        </div>
      ) : null}

      <section className="rounded-md border border-line bg-surface p-4" data-testid="draft-required-evidence" aria-live="polite">
        <Section title={t('requiredEvidence.titleFor', { basis: tBasis(d.basis), status: tStatus(partner.status) })}>
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {required.map((kind) => (
                <li key={kind} className="flex flex-wrap items-center gap-2 text-body text-ink">
                  <span>{t(`requiredEvidence.kind.${evidenceKindLabelKey(kind, d.basis)}`)}</span>
                  {kind === 'agreement' && d.basis === 'agent57' ? <span className="text-hint text-muted-ink">— {t('requiredEvidence.agreementAgent57Hint')}</span> : null}
                  <StatusBadge tone="neutral">{t('requiredEvidence.required')}</StatusBadge>
                </li>
              ))}
            </ul>
            <p className="text-hint text-muted-ink">{d.basis === 'agent57' ? t('requiredEvidence.agentNote') : t('requiredEvidence.foreignNote')}</p>
          </div>
        </Section>
      </section>

      <PartnerReasonPrompt needs={reasonNeeds} noticeReason={noticeReason} overdueReason={overdueReason} onNoticeReason={setNoticeReason} onOverdueReason={setOverdueReason} purposeReason={purposeReason} onPurposeReason={setPurposeReason} purposeDetail={purposeDetail} noticeValidUntil={payment.reasonsNeeded.noticeValidUntil} />

      <div className="space-y-2">
        <FormGrid>
          {endowmentAllowed(d.basis, partner.status) ? (
            // Board 15g: Kästchen mit Hilfezeile; nach dem Einreichen fest wie die übrigen Felder.
            <FormField id="payment-asset-endowment" label={t('assetEndowment')} hint={t('assetEndowmentHint')} toggle size="full">
              <Checkbox id="payment-asset-endowment" checked={d.assetEndowment} disabled={!canWrite} onCheckedChange={(on) => set({ assetEndowment: on === true })} data-testid="payment-asset-endowment" />
            </FormField>
          ) : null}
          {d.basis === 'agent57' || partner.status === 'foreignBody' || d.agreementDocument ? (
            <FormCell size="m">
              <DocumentPicker id="payment-agreement-doc" name="agreementDocumentId" label={t(`agreementDocumentFor.${d.basis}`)} value={d.agreementDocument} onChange={(doc) => set({ agreementDocument: doc })} required={d.basis === 'agent57' || partner.status === 'foreignBody'} />
            </FormCell>
          ) : null}
          <FormCell size="s" data-testid="payment-proof">
            <FormField id="payment-proof-months" label={t('proof.label')} hint={d.proofMonths === null ? t('proof.fromUsual', { count: partner.usualProofMonths }) : t('proof.own', { count: partner.usualProofMonths })}>
              <div className="flex flex-wrap items-center gap-3">
                <Select id="payment-proof-months" className="w-auto" value={String(months)} disabled={!canWrite} onChange={(e) => set({ proofMonths: Number(e.target.value) === partner.usualProofMonths && d.proofMonths === null ? null : Number(e.target.value) })}>
                  {PROOF_MONTHS.map((n) => (
                    <option key={n} value={n}>
                      {t('proof.months', { count: n })}
                    </option>
                  ))}
                </Select>
                {/* Task 6c (Joe 28.09.): die Frist läuft ab dem Zahlungstag — ein Datum gibt es erst, wenn er feststeht (nachträglich: die gewählte Zeile). */}
                {d.retroactive && chosenLines.length > 0 ? <span className="text-body tabular-nums text-ink">{fmt.date(proofDueDate(paymentDay, months))}</span> : null}
              </div>
            </FormField>
          </FormCell>
          <FormCell size="full" data-testid="payment-retroactive">
            <FormField id="payment-retroactive" label={t('retroactive')} toggle>
              <Checkbox id="payment-retroactive" checked={d.retroactive} disabled={!canWrite} onCheckedChange={(v) => set({ retroactive: v === true })} />
            </FormField>
          </FormCell>
        </FormGrid>
        {d.retroactive ? (
          <div data-testid="payment-retroactive-warn">
            <Notice level="warn">{t('retroactiveWarn')}</Notice>
          </div>
        ) : null}
      </div>

      {d.retroactive ? (
        <section data-testid="paid-line-picker">
          <Section title={t('paidLines.title')}>
            <div className="space-y-2">
              {lineOptions.length === 0 ? (
                <p className="text-meta text-muted-ink">{t('paidLines.empty')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {lineOptions.map((line) => (
                    <li key={line.id}>
                      <label className="flex min-h-11 items-center gap-2 text-meta">
                        <Checkbox
                          checked={d.paidLineIds.includes(line.id)}
                          disabled={!canWrite}
                          onCheckedChange={(v) => update((prev) => ({ ...prev, paidLineIds: v === true ? [...prev.paidLineIds, line.id] : prev.paidLineIds.filter((id) => id !== line.id) }))}
                        />
                        <span className="tabular-nums">
                          {line.entryNumber ? <><span className="font-mono">{line.entryNumber}</span>{' · '}</> : null}
                          {fmt.date(line.entryDate)} · {formatEuro(Math.abs(line.amountCents))}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </section>
      ) : (
        <section data-testid="position-rows">
          <Section title={t('positions.title')}
            actions={
              <>
                {canWrite ? (
                  <span className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => addPosition('money')} data-testid="position-add-money">
                      {t('positions.add')} ({t('positions.money')})
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => addPosition('goods')} data-testid="position-add-goods">
                      {t('positions.add')} ({t('positions.goods')})
                    </Button>
                  </span>
                ) : null}
              </>
            }
          >
            <div className="space-y-3">
              {d.positions.map((p) => (
                <div key={p.key} className="grid grid-cols-1 gap-2 rounded-md border border-line bg-surface p-3 sm:grid-cols-4" data-testid="position-row">
                  <Overline as="span" className="sm:col-span-4">{p.kind === 'money' ? t('positions.money') : t('positions.goods')}</Overline>
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
                    <Button type="button" variant="outline" size="sm" onClick={() => update((prev) => ({ ...prev, positions: prev.positions.filter((x) => x.key !== p.key) }))} data-testid="position-remove">
                      {t('positions.remove')}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        </section>
      )}

      {canWrite ? (
        <FormActionBar
          mode="create"
          testId="payment-footer"
          saveTestId="payment-submit"
          status={{ state: saveState, pending }}
          extraActions={
            <Button type="button" variant="outline" disabled={busy} onClick={() => void keepDraft()} data-testid="payment-save">
              {t('save')}
            </Button>
          }
          saveLabel={t('submit')}
          onSave={() => void submit()}
          pending={busy}
          state={refusal ?? undefined}
        />
      ) : null}
    </div>
  );
}
