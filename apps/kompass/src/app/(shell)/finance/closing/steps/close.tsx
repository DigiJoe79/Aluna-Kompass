'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Button } from '@/components/ui/button';
import type { ClosingStepBody } from '../step-body';

/**
 * Schritt 8: was den Abschluss noch aufhält, aus `previewPeriodClose` als `RequirementList` mit Links (Zeilen, Designer
 * Runde 8, Frage 3.1); ohne Hemmnis
 * „Jahr abschließen …“ (primär, `onConfirm` öffnet die Rückfrage). Ohne Recht steht der Satz statt des Knopfs.
 */
export function CloseStep({ step, status, onConfirm }: ClosingStepBody<'close'>) {
  const t = useTranslations('finance.closing.close');
  const c = useTranslations('finance.closing');
  const preview = step.facts.preview;
  const year = encodeURIComponent(status.fiscalYearId);
  const blockers: { key: string; title: string; href: string }[] = [];
  if (preview) {
    if (preview.previousYearOpen) blockers.push({ key: 'previousYearOpen', title: t('items.previousYearOpen'), href: '/finance/closing' });
    if (preview.draftsInPeriod.length > 0) blockers.push({ key: 'drafts', title: t('items.drafts', { count: preview.draftsInPeriod.length }), href: `/finance/entries?year=${year}&state=draft` });
    const undocumented = preview.undocumented.filter((u) => !u.justified).length;
    if (undocumented > 0) blockers.push({ key: 'undocumented', title: t('items.undocumented', { count: undocumented }), href: `/finance/entries?year=${year}&novoucher=1` });
    if (preview.openTransactionsInPeriod.length > 0) blockers.push({ key: 'openTransactions', title: t('items.openTransactions', { count: preview.openTransactionsInPeriod.length }), href: '/finance/work' });
    if (preview.accountsWithoutStatement.length > 0) blockers.push({ key: 'accountsWithoutStatement', title: t('items.accountsWithoutStatement', { accounts: preview.accountsWithoutStatement.map((a) => a.name).join(', ') }), href: '/finance/imports' });
  }
  const items: RequirementListItem[] = blockers.map((b) => ({ ...b, done: false, blocked: false, canSelf: true, canDoNames: [], canDoText: '', actionLabel: t('itemAction'), doneLabel: t('itemDone') }));
  // Maßstab ist der Dienst (`canClose`); wartende Korrekturen sind ein Hinweis, keine Sperre (`ledger/period.ts`).
  const canClose = status.me.canClose && (preview?.canClose ?? false);
  const pending = preview?.pendingCorrections ?? 0;
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-close">
      <p className="text-meta text-ink-2">{t('intro', { year: status.designation })}</p>
      {items.length > 0 ? (
        <>
          <p className="text-meta text-ink-2">{t('blockers')}</p>
          <RequirementList variant="rows" items={items} />
        </>
      ) : null}
      {pending > 0 ? (
        <p className="text-meta text-ink-2" data-testid="closing-pending-corrections">
          {/* Der Punkt steht hier, nicht in `items.*`: Die Schlüssel sind auch Titel der `RequirementList`. */}
          {t('items.pendingCorrections', { count: pending })}.{' '}
          <Link href="/finance/approvals" className="text-link underline-offset-2 hover:underline">
            {t('itemAction')}
          </Link>
        </p>
      ) : null}
      {canClose ? (
        <div>
          <Button type="button" onClick={onConfirm} data-testid="closing-close">
            {t('action')}
          </Button>
        </div>
      ) : !status.me.canClose ? (
        <p className="text-meta text-muted-ink">{c('noRightClose')}</p>
      ) : (
        <p className="text-meta text-muted-ink">{t('blocked')}</p>
      )}
    </div>
  );
}
