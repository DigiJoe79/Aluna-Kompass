'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Notice } from '@/components/notice';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { applyTaxDefaultsAction, confirmSetupStepAction } from './actions';

export interface ChecklistStep {
  key: 'fiscalYear' | 'account' | 'roles' | 'categories' | 'tax' | 'importFormat';
  done: boolean;
  blocked: boolean;
  detail: Record<string, string | number>;
  canDo: string[];
  /** Ob der Betrachter selbst das Recht des Schritts hat (`step.permission`, server-seitig geprüft). */
  canSelf: boolean;
}

const STEP_HREF: Record<ChecklistStep['key'], string> = {
  fiscalYear: '/admin/finance?panel=fiscalYears',
  account: '/admin/finance?panel=accounts',
  roles: '/admin/roles',
  categories: '/admin/finance?panel=categories',
  tax: '/admin/finance?panel=tax',
  // F4b: der Assistent — sein erster Schritt rät zu CAMT, das sich beim ersten Import von selbst setzt.
  importFormat: '/finance/imports/format',
};

/** H1 — Einstieg: erledigte Zeilen bleiben stehen, blockierte nennen ihre Abhängigkeit. */
export function ChecklistPanel({ steps, complete }: { steps: ChecklistStep[]; complete: boolean }) {
  const t = useTranslations('finance.admin.checklist');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const applyDefaults = async () => {
    setPending(true);
    const result = await applyTaxDefaultsAction();
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  const confirmCategories = async () => {
    setPending(true);
    const result = await confirmSetupStepAction('categories');
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  const items: RequirementListItem[] = steps.map((step) => {
    const canSelf = step.canSelf;
    const blockedText = step.blocked ? t(`blocked.${step.key}`) : undefined;
    const detail = step.key === 'account' && typeof step.detail.accounts === 'number' ? t('detail.account', { accounts: step.detail.accounts, withoutOpening: step.detail.withoutOpening ?? 0 }) : step.key === 'roles' && step.detail.rolesWithoutUser ? t('detail.rolesWithoutUser', { names: step.detail.rolesWithoutUser }) : step.key === 'roles' && step.detail.usersWithoutContact ? t('detail.usersWithoutContact', { count: step.detail.usersWithoutContact }) : step.key === 'importFormat' && typeof step.detail.missing === 'number' && step.detail.missing > 0 ? t('detail.importFormat', { missing: step.detail.missing }) : undefined;

    const extra =
      step.key === 'tax' && !step.done && canSelf ? (
        <button type="button" onClick={() => void applyDefaults()} disabled={pending} className="rounded-sm border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-2" data-testid="apply-tax-defaults">
          {t('applyTaxDefaults')}
        </button>
      ) : step.key === 'categories' && !step.done && canSelf ? (
        <button type="button" onClick={() => void confirmCategories()} disabled={pending} className="rounded-sm border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-2" data-testid="confirm-categories">
          {t('reviewCategories')}
        </button>
      ) : undefined;

    return {
      key: step.key,
      title: t(`steps.${step.key}`),
      done: step.done,
      blocked: step.blocked,
      blockedText,
      detail,
      canSelf,
      canDoNames: step.canDo,
      canDoText: t('canDo', { names: step.canDo.join(', ') }),
      href: STEP_HREF[step.key],
      actionLabel: t('open'),
      doneLabel: t('done'),
      extra,
    };
  });

  return (
    <section className="space-y-4" data-testid="checklist-panel">
      {complete ? <Notice level="hint">{t('completeHint')}</Notice> : null}
      <RequirementList items={items} />
    </section>
  );
}
