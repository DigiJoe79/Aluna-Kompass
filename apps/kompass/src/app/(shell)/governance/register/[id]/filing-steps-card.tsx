'use client';

import type { FilingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Steps, stepsFrom } from '@/components/steps';
import { Button, buttonVariants } from '@/components/ui/button';
import { filingSteps, FILING_STEP_KEYS } from '@/lib/governance/filing-steps';
import type { FilingDialog } from './dialogs';

/** Die vier Schritte der Anmeldung (Board 8b) als kompakte Karte; der aktive trägt seine Handlung. */
export function FilingStepsCard({ context, manage, open }: { context: FilingContext; manage: boolean; open: (d: FilingDialog) => void }) {
  const t = useTranslations('governance.register.steps');
  const { date } = useDateFormat();
  const f = context.filing;
  const s = filingSteps(f, context.requirements);
  const orderIndex = f.interimOrders.findIndex((o) => o.resolvedOn === null);
  const order = orderIndex >= 0 ? f.interimOrders[orderIndex]! : null;
  const detail: Record<string, React.ReactNode> = {
    compile: s.done.compile ? (f.notarizedOn ? t('compileDone', { date: date(f.notarizedOn) }) : t('compileMet')) : t('compileActive', { met: s.detail.compile.met, required: s.detail.compile.required }),
    notary: s.done.notary && f.notarizedOn ? t('notaryDone', { date: date(f.notarizedOn), notary: context.notary?.name ?? '' }) : undefined,
    submitted: s.done.submitted && f.submittedOn ? t('submittedDone', { date: date(f.submittedOn) }) : undefined,
    registered: f.registeredOn ? t('registeredDone', { date: date(f.registeredOn) }) : undefined,
  };
  const action = (key: string) => {
    if (!manage || s.active !== key) return undefined;
    if (key === 'notary' || (key === 'compile' && !f.notarizedOn)) return <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'notary' })}>{t('notaryAction')}</Button>;
    if (key === 'submitted' && !order) return <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'submitted' })}>{t('submittedAction')}</Button>;
    if (key === 'registered') return <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'complete' })}>{t('registeredAction')}</Button>;
    return undefined;
  };
  const steps = stepsFrom(FILING_STEP_KEYS.map((k) => ({ key: k, label: t(`labels.${k}`), detail: detail[k] })), s.active).map((step) => ({
    ...step,
    action: action(step.key),
    below:
      step.key === 'submitted' && s.active === 'submitted' ? (
        <div className="flex flex-col gap-3">
          {order ? (
            <Notice
              level="refuse"
              title={t('interimTitle', { date: date(order.on) })}
              action={
                <span className="flex flex-wrap gap-2">
                  {order.documentId ? <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/dms/${order.documentId}`}>{t('interimView')}</Link> : null}
                  {manage ? <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'renotarize', index: orderIndex })}>{t('renotarize')}</Button> : null}
                  {manage ? <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'resolveInterim', index: orderIndex })}>{t('resolveInterim')}</Button> : null}
                </span>
              }
            >
              {order.deadline ? t('interimDeadline', { date: date(order.deadline) }) : t('interimNoDeadline')}
            </Notice>
          ) : null}
          {f.warnings.includes('transparencyChecksOpen') ? <Notice level="warn">{t('transparencyOpen')}</Notice> : null}
          {f.warnings.includes('notarizationMissing') ? <Notice level="warn">{t('notarizationMissing')}</Notice> : null}
        </div>
      ) : step.key === 'compile' && s.active === 'compile' && f.warnings.includes('overdueByAttached') ? (
        <Notice level="warn">{t('overdueByAttached', { date: f.dueOn ? date(f.dueOn) : '' })}</Notice>
      ) : step.key === 'registered' && f.warnings.includes('statuteOmitsUnregistered') ? (
        <Notice level="warn">{t('statuteOmitsUnregistered')}</Notice>
      ) : undefined,
  }));
  return <Steps density="compact" card steps={steps} label={t('label')} done={t('done', { date: f.registeredOn ? date(f.registeredOn) : '' })} testId="filing-steps" />;
}
