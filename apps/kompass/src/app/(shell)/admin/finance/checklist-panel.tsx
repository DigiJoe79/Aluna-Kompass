'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { applyTaxDefaultsAction, confirmSetupStepAction } from './actions';
import { panelHref } from '@/components/panel-nav';

export interface ChecklistStep {
  key: 'fiscalYear' | 'account' | 'roles' | 'categories' | 'tax' | 'importFormat' | 'notice' | 'machineProcedure' | 'waiverBasis' | 'boardRemuneration' | 'boardMembers' | 'documentBases';
  done: boolean;
  blocked: boolean;
  detail: Record<string, string | number>;
  canDo: string[];
  /** Ob der Betrachter selbst das Recht des Schritts hat (`step.permission`, server-seitig geprüft). */
  canSelf: boolean;
}

const STEP_HREF: Record<ChecklistStep['key'], string> = {
  fiscalYear: panelHref('/admin/finance', 'fiscalYears'),
  account: panelHref('/admin/finance', 'accounts'),
  roles: '/admin/roles',
  categories: panelHref('/admin/finance', 'categories'),
  tax: panelHref('/admin/finance', 'tax'),
  // F4b: der Assistent — sein erster Schritt rät zu CAMT, das sich beim ersten Import von selbst setzt.
  importFormat: '/finance/imports/format',
  // F6a: die Seite der Bescheide (Task 8).
  notice: '/finance/donations/notices',
  // F6a Task 4: das maschinelle Verfahren steht auf derselben Seite (Abschnitt, Task 8).
  machineProcedure: '/finance/donations/notices',
  // F8a Task 4: die Einstellung steht beim Schalter „Aufwandsspenden“.
  waiverBasis: panelHref('/admin/finance', 'tax'),
  // Befund 51 b: die Basen-Übersicht der Dokument-Einrichtung.
  documentBases: '/admin/documents',
  // F8b Annahme 10: der Einrichtungspunkt steht unter Steuerliches.
  boardRemuneration: panelHref('/admin/finance', 'tax'),
  // Befund T: die Rolle „Vorstand“ steht am Kontakt.
  boardMembers: '/contacts',
};

/** H1 — Einstieg: erledigte Zeilen bleiben stehen, blockierte nennen ihre Abhängigkeit. */
export function ChecklistPanel({ steps, complete }: { steps: ChecklistStep[]; complete: boolean }) {
  const t = useTranslations('finance.admin.checklist');
  // „Die Einrichtung ist vollständig“ erscheint erst nach einer Handlung (letzter Schritt bestätigt, Vorgaben übernommen …)
  // und hat als hint keine Rolle — der Toast sagt das Ergebnis an (MUSTER § A, Designer 2026-10-08). Nur beim Wechsel,
  // nicht beim Laden einer schon vollständigen Einrichtung; die Kennung hält ihn einmalig.
  const wasComplete = useRef(complete);
  useEffect(() => {
    if (complete && !wasComplete.current) toast.success(t('completeHint'), { id: 'setup-complete' });
    wasComplete.current = complete;
  }, [complete, t]);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Je Schritt eine eigene Ablehnung, über dem Knopf des Schritts.
  const taxFb = useActionFeedback();
  const categoriesFb = useActionFeedback();

  const applyDefaults = async () => {
    setPending(true);
    const result = await taxFb.run(() => applyTaxDefaultsAction(), { retry: () => void applyDefaults() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const confirmCategories = async () => {
    setPending(true);
    const result = await categoriesFb.run(() => confirmSetupStepAction('categories'), { retry: () => void confirmCategories() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const items: RequirementListItem[] = steps.map((step) => {
    const canSelf = step.canSelf;
    const blockedText = step.blocked ? t(`blocked.${step.key}`) : undefined;
    const detail = step.key === 'account' && typeof step.detail.accounts === 'number' ? t('detail.account', { accounts: step.detail.accounts, withoutOpening: step.detail.withoutOpening ?? 0 }) : step.key === 'roles' && step.detail.rolesWithoutUser ? t('detail.rolesWithoutUser', { names: step.detail.rolesWithoutUser }) : step.key === 'roles' && step.detail.usersWithoutContact ? t('detail.usersWithoutContact', { count: step.detail.usersWithoutContact }) : step.key === 'importFormat' && typeof step.detail.missing === 'number' && step.detail.missing > 0 ? t('detail.importFormat', { missing: step.detail.missing }) : step.key === 'notice' && typeof step.detail.validUntil === 'string' ? t('detail.notice', { validUntil: step.detail.validUntil }) : step.key === 'machineProcedure' && typeof step.detail.missing === 'string' && step.detail.missing !== '' ? t('detail.machineProcedure', { missing: step.detail.missing.split(',').map((key) => t(`machineMissing.${key}`)).join(', ') }) : step.key === 'documentBases' && typeof step.detail.missing === 'string' && step.detail.missing !== '' ? t('detail.documentBases', { missing: step.detail.missing.split(',').join(', ') }) : undefined;

    const extra =
      step.key === 'tax' && !step.done && canSelf ? (
        <div className="space-y-2">
          <RefusalNotice action state={taxFb.state} />
          <Button type="button" variant="outline" size="sm" onClick={() => void applyDefaults()} disabled={pending} data-testid="apply-tax-defaults">
            {t('applyTaxDefaults')}
          </Button>
        </div>
      ) : step.key === 'categories' && !step.done && canSelf ? (
        <div className="space-y-2">
          <RefusalNotice action state={categoriesFb.state} />
          <Button type="button" variant="outline" size="sm" onClick={() => void confirmCategories()} disabled={pending} data-testid="confirm-categories">
            {t('reviewCategories')}
          </Button>
        </div>
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
