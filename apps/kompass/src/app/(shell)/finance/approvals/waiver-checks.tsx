'use client';

import type { WaiverCheck } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';

export interface WaiverState {
  declaredOn: string;
  claimAgreedConfirmed: boolean;
  lateReason: string;
}

/**
 * Die vier Prüfungen des Verzichts als gruppierte Prüfliste (Designer-README
 * 3h, Muster C1-2): *Anspruch vorab vereinbart* kann Kompass nicht wissen —
 * dafür steht das Kontrollkästchen des Prüfers über der Liste; *rechtzeitig*
 * und *hätte zahlen können* rechnet der Dienst für den Tag des Verzichts;
 * *Verzichtserklärung liegt vor* bietet an, sie zu erzeugen. Eine späte
 * Vereinbarung oder ein später Verzicht sperrt nicht, verlangt aber eine
 * Begründung im Warnkasten.
 */
export function WaiverChecks({
  checks,
  basis,
  state,
  onChange,
  declaration,
  onCreateDeclaration,
  onUploadSigned,
  busy,
}: {
  checks: WaiverCheck[];
  basis: { text: string | null; agreedOn: string | null };
  state: WaiverState;
  onChange: (next: Partial<WaiverState>) => void;
  declaration: { href: string | null; signedHref: string | null };
  onCreateDeclaration: () => void;
  onUploadSigned: (file: File) => void;
  busy: boolean;
}) {
  const t = useTranslations('finance.approvals.waiver');
  const fmt = useDateFormat();
  const fileInput = useRef<HTMLInputElement>(null);
  // Beide Warnungen teilen eine Begründung am Antrag — das Feld steht nur einmal.
  let reasonUsed = false;
  const reason = () => {
    if (reasonUsed) return undefined;
    reasonUsed = true;
    return { name: 'waiver-late-reason', value: state.lateReason, onChange: (lateReason: string) => onChange({ lateReason }), label: t('reasonLabel') };
  };

  const base = { canSelf: true, canDoNames: [], canDoText: '', href: '', actionLabel: t('open'), doneLabel: t('done'), blocked: false };
  const items: RequirementListItem[] = checks.map((check): RequirementListItem => {
    const d = check.detail;
    switch (check.key) {
      case 'claimAgreed':
        return {
          ...base,
          key: 'claimAgreed',
          title: t('agreed'),
          done: check.done,
          blocked: check.blocked,
          detail: basis.text ? (basis.agreedOn ? t('agreedDetailDate', { basis: basis.text, date: fmt.date(basis.agreedOn) }) : t('agreedDetail', { basis: basis.text })) : undefined,
          warning: check.warning ? { text: t('agreedLate', { agreedOn: fmt.date(String(d.agreedOn ?? '')), earliest: fmt.date(String(d.earliestPosition ?? '')) }), reason: reason() } : undefined,
        };
      case 'timely':
        return {
          ...base,
          key: 'timely',
          title: t('timely'),
          done: check.done,
          detail: d.deadline ? t('timelyDetail', { deadline: fmt.date(String(d.deadline)) }) : undefined,
          warning: check.warning ? { text: t('timelyLate', { deadline: fmt.date(String(d.deadline ?? '')) }), reason: reason() } : undefined,
        };
      case 'fundsAvailable': {
        const values = { date: fmt.date(String(d.date ?? '')), free: formatEuro(Number(d.freeCents ?? 0)), amount: formatEuro(Number(d.amountCents ?? 0)) };
        return { ...base, key: 'fundsAvailable', title: t('funds'), done: check.done, blocked: check.blocked, detail: check.done ? t('fundsDetail', values) : t('fundsShort', values) };
      }
      case 'declaration':
        return {
          ...base,
          key: 'declaration',
          title: t('declaration'),
          done: check.done,
          blocked: check.blocked,
          extra: check.done ? undefined : (
            <Button type="button" size="sm" variant="outline" disabled={busy || !state.declaredOn} onClick={onCreateDeclaration}>
              {t('declarationCreate')}
            </Button>
          ),
        };
    }
  });

  return (
    <section data-testid="waiver-checks" aria-labelledby="waiver-checks-title" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h4 id="waiver-checks-title" className="text-[13px] font-semibold text-muted-ink">
        {t('title')}
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="waiver-declared-on">{t('declaredOn')}</Label>
          <Input id="waiver-declared-on" type="date" value={state.declaredOn} onChange={(e) => onChange({ declaredOn: e.target.value })} />
        </div>
        <label htmlFor="waiver-agreed" className="flex min-h-11 cursor-pointer items-center gap-3 self-end text-[14px] text-ink">
          <input id="waiver-agreed" type="checkbox" checked={state.claimAgreedConfirmed} onChange={(e) => onChange({ claimAgreedConfirmed: e.target.checked })} className="size-5 shrink-0 rounded border-line" />
          {t('agreed')}
        </label>
      </div>
      <RequirementList items={items} grouping="open-first" />
      {declaration.href ? (
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <a href={declaration.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-link">
            {t('declarationOpen')}
          </a>
          {declaration.signedHref ? (
            <a href={declaration.signedHref} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-link">
              {t('signedOpen')}
            </a>
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadSigned(file);
                  e.target.value = '';
                }}
              />
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                {t('signedUpload')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
