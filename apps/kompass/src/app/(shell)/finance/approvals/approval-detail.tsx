'use client';

import type { ApprovalView, ExpenseCategorySuggestion, WaiverCheck } from '@kompass/module-finance';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ApprovalDetailFrame } from '@/components/finance/approval-detail-frame';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';
import { approveInput, type ApprovalDecision } from '@/lib/finance/expenses';
import { cn } from '@/lib/utils';
import { approveExpenseClaimAction, attachSignedWaiverAction, createWaiverDeclarationAction, waiverChecksAction } from '../expenses/actions';
import { RejectDialog } from './reject-dialog';
import { WaiverChecks, type WaiverState } from './waiver-checks';

/** Ob in dieser Sitzung schon ein Antrag rechts stand — erst ab dem zweiten wandert der Fokus auf den Kopf. */
let shownBefore = false;

export interface CategoryOption {
  id: string;
  name: string;
  sphere: string;
  explanation?: string;
}

/**
 * D3 rechts: ein eingereichter Antrag in der gemeinsamen Detailansicht
 * (Designer-README 3h). Wer prüft, ergänzt je Position die Kategorie (Pflicht)
 * und „bezahlt aus“; der Vorschlag ist schwach — nie vorbelegt, mit Grund und
 * „übernehmen“. Bei Verzicht darunter die vier Prüfungen. Die Fußleiste klebt
 * und sagt, was nach der Freigabe entsteht. „Freigeben“ ist nie grau: Fehlt
 * etwas, steht die Ablehnung des Dienstes darüber.
 */
export function ApprovalDetail({
  claim,
  categories,
  purposes,
  projects,
  suggestions,
  checks: initialChecks,
  today,
}: {
  claim: ApprovalView;
  categories: CategoryOption[];
  purposes: { id: string; name: string }[];
  projects: Record<string, string>;
  suggestions: ExpenseCategorySuggestion[];
  checks: WaiverCheck[] | null;
  today: string;
}) {
  const t = useTranslations('finance.approvals');
  const tRow = useTranslations('finance.splitRow');
  const fmt = useDateFormat();
  const router = useRouter();
  const headRef = useRef<HTMLDivElement>(null);
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [waiver, setWaiver] = useState<WaiverState>({ declaredOn: claim.waiverDeclaredOn ?? today, claimAgreedConfirmed: claim.claimAgreedConfirmed, lateReason: '' });
  const [checks, setChecks] = useState<WaiverCheck[] | null>(initialChecks);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const firstReceipt = claim.positions.find((p) => p.documentId)?.id ?? null;
  const [previewId, setPreviewId] = useState<string | null>(firstReceipt);

  // Wechsel zum nächsten Antrag über einen Link: Der Fokus landet auf dessen Kopf. Mit den Pfeiltasten bleibt er
  // in der Liste; beim Laden der Seite bleibt er, wo der Browser ihn hinsetzt.
  useEffect(() => {
    if (shownBefore && document.activeElement === document.body) headRef.current?.focus();
    shownBefore = true;
  }, [claim.id]);

  // Nach dem Erzeugen der Verzichtserklärung (neuer Stand des Antrags) die Prüfungen mit dem eigenen Häkchen neu rechnen.
  const recheck = async (next: WaiverState) => {
    if (!claim.waiver || !next.declaredOn) return;
    const state = await waiverChecksAction(claim.id, next.declaredOn, next.claimAgreedConfirmed);
    if (state.status === 'success') setChecks(state.data as WaiverCheck[]);
  };
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;
  const waiverRef = useRef(waiver);
  waiverRef.current = waiver;
  useEffect(() => {
    void recheckRef.current(waiverRef.current);
  }, [claim.version]);

  const changeWaiver = (patch: Partial<WaiverState>) => {
    const next = { ...waiver, ...patch };
    setWaiver(next);
    setRefusal(null);
    if ('declaredOn' in patch || 'claimAgreedConfirmed' in patch) void recheck(next);
  };

  const decide = (positionId: string, patch: Partial<ApprovalDecision>) => {
    setDecisions((all) => ({ ...all, [positionId]: { categoryId: '', purposeId: '', ...all[positionId], ...patch } }));
    setRefusal(null);
  };

  const run = async (fn: () => Promise<{ status: string; message?: string }>) => {
    setBusy(true);
    setRefusal(null);
    try {
      const state = await fn();
      if (state.status === 'success') router.refresh();
      else if (state.status === 'error') setRefusal(state.message ?? '');
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    run(() => approveExpenseClaimAction(approveInput({ claimId: claim.id, version: claim.version, positions: claim.positions, decisions, ...(claim.waiver ? { waiver } : {}) })));

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const receiptHref = (documentId: string) => `/finance/expenses/${claim.id}/receipt/${documentId}`;
  const amount = formatEuro(claim.totalCents);
  const preview = claim.positions.find((p) => p.id === previewId && p.documentId);

  const positions = (
    <section aria-labelledby="approval-positions" className="space-y-3">
      <h4 id="approval-positions" className="sr-only">
        {t('positions')}
      </h4>
      <ol className="space-y-3">
        {claim.positions.map((p, i) => {
          const decision = decisions[p.id] ?? { categoryId: '', purposeId: '' };
          const category = categories.find((c) => c.id === decision.categoryId);
          const suggestion = suggestions.find((s) => s.positionId === p.id);
          const id = (field: string) => `approval-${p.id}-${field}`;
          return (
            <li
              key={p.id}
              data-testid="approval-position"
              onClick={() => p.documentId && setPreviewId(p.id)}
              className={cn('space-y-3 rounded-lg border bg-surface p-4', previewId === p.id ? 'border-line-strong' : 'border-line')}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-muted-ink">{t('position', { n: i + 1 })}</p>
                  <p className="text-[14px] text-ink">{p.kind === 'trip' ? t('trip', { from: p.tripFrom ?? '', to: p.tripTo ?? '', km: p.tripKm ?? 0 }) : p.purpose}</p>
                  <p className="text-[12px] text-muted-ink">
                    {fmt.date(p.positionDate)}
                    {p.kind === 'trip' && p.tripReason ? ` · ${p.tripReason}` : ''}
                    {p.projectId && projects[p.projectId] ? ` · ${t('project', { name: projects[p.projectId]! })}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">{formatEuro(p.amountCents)}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={id('category')}>{t('category')}</Label>
                  <Select id={id('category')} value={decision.categoryId} onChange={(e) => decide(p.id, { categoryId: e.target.value })}>
                    <option value="">{t('categoryPlaceholder')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  {category ? (
                    <p data-testid="category-explanation" className="text-[11px] text-muted-ink">
                      {tRow(`sphere.${category.sphere}`)}
                      {category.explanation ? ` · ${category.explanation}` : ''}
                    </p>
                  ) : null}
                </div>
                {purposes.length > 0 ? (
                  <div className="space-y-1">
                    <Label htmlFor={id('purpose')}>{t('paidFrom')}</Label>
                    <Select id={id('purpose')} value={decision.purposeId} onChange={(e) => decide(p.id, { purposeId: e.target.value })}>
                      <option value="">{t('freeFunds')}</option>
                      {purposes.map((purpose) => (
                        <option key={purpose.id} value={purpose.id}>
                          {purpose.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
              </div>

              {suggestion && suggestion.categoryId !== decision.categoryId ? (
                <p data-testid="category-suggestion" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-ink">
                  <span>
                    {t('suggestion.because')}{' '}
                    {suggestion.reason.kind === 'rule' ? t('suggestion.rule', { name: suggestion.reason.ruleName }) : t('suggestion.similarEntry', { number: suggestion.reason.entryNumber })}
                    {' → '}
                    {categoryName(suggestion.categoryId)}
                  </span>
                  <Button type="button" variant="link" size="xs" onClick={() => decide(p.id, { categoryId: suggestion.categoryId })}>
                    {t('suggestion.take')}
                  </Button>
                </p>
              ) : null}

              {p.documentId ? (
                <a href={receiptHref(p.documentId)} target="_blank" rel="noreferrer" className="inline-flex text-[13px] underline underline-offset-2 hover:text-link lg:hidden">
                  {t('receipt.view')}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!claim.receiptsVisible ? <p className="text-[12px] text-muted-ink">{t('receipt.hidden')}</p> : null}
    </section>
  );

  const receiptPane = preview?.documentId ? (
    <figure data-testid="receipt-preview" className="hidden space-y-1 lg:block">
      <figcaption className="text-[12px] text-muted-ink">{t('receipt.preview', { n: claim.positions.indexOf(preview) + 1 })}</figcaption>
      <iframe title={t('receipt.preview', { n: claim.positions.indexOf(preview) + 1 })} src={receiptHref(preview.documentId)} className="h-[520px] w-full rounded-md border border-line bg-paper" />
    </figure>
  ) : null;

  const footer = (
    <>
      {refusal ? (
        <Notice level="refuse" title={t('footer.refused')}>
          {refusal}
        </Notice>
      ) : null}
      <p className="text-[13px] text-ink-2">{claim.waiver ? t('footer.waiver', { name: claim.contactName, amount }) : t('footer.payable', { name: claim.contactName, amount })}</p>
      <p className="text-[12px] text-muted-ink">{t('footer.humanOnly')}</p>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button type="button" variant="outline" className="max-lg:h-12" disabled={busy} onClick={() => setRejecting(true)}>
          {t('footer.reject')}
        </Button>
        <Button type="button" className="max-lg:h-12" disabled={busy} onClick={() => void approve()}>
          {t('footer.approve')}
        </Button>
      </div>
    </>
  );

  return (
    <>
      <ApprovalDetailFrame
        headRef={headRef}
        head={{
          kind: t(claim.waiver ? 'kind.waiver' : 'kind.expenseClaim'),
          number: claim.number ?? '',
          amount,
          person: claim.contactName,
          received: t('head.receivedAt', { at: fmt.dateTime(claim.submittedAt) }),
          note: claim.waiver ? t('head.noIban') : claim.ibanMasked ? t('head.iban', { iban: claim.ibanMasked }) : undefined,
        }}
        requirements={
          claim.waiver && checks ? (
            <WaiverChecks
              checks={checks}
              basis={{ text: claim.waiverBasisText, agreedOn: claim.waiverAgreedOn }}
              state={waiver}
              onChange={changeWaiver}
              busy={busy}
              declaration={{
                href: claim.waiverDeclarationDocumentId ? receiptHref(claim.waiverDeclarationDocumentId) : null,
                signedHref: claim.waiverSignedDocumentId ? receiptHref(claim.waiverSignedDocumentId) : null,
              }}
              onCreateDeclaration={() => void run(() => createWaiverDeclarationAction(claim.id, waiver.declaredOn))}
              onUploadSigned={(file) => void run(async () => attachSignedWaiverAction(claim.id, new Uint8Array(await file.arrayBuffer())))}
            />
          ) : undefined
        }
        footer={footer}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {positions}
          {receiptPane}
        </div>
      </ApprovalDetailFrame>
      <RejectDialog open={rejecting} onOpenChange={setRejecting} claimId={claim.id} number={claim.number ?? ''} person={claim.contactName} />
    </>
  );
}
