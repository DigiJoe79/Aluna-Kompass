'use client';

import type { ModuleStatus } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Switch } from '@/components/ui/switch';
import { setModuleEnabledAction } from './actions';
import { KeyLine } from '@/components/key-line';
import { SectionHeading } from '@/components/section';

export function ModuleCard({ module }: { module: ModuleStatus }) {
  const t = useTranslations('modules');
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();
  const name = t.has(`names.${module.key}`) ? t(`names.${module.key}`) : module.key;
  return (
    <section
      aria-label={name}
      className="grid grid-cols-[minmax(0,1fr)_190px] gap-4 rounded-lg border border-line bg-surface px-[18px] py-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <SectionHeading>{name}</SectionHeading>
          {module.locked ? (
            <StatusBadge tone="brand">{t('alwaysActive')}</StatusBadge>
          ) : (
            <StatusBadge tone={module.enabled ? 'success' : 'neutral'}>
              {module.enabled ? t('enabled') : t('disabled')}
            </StatusBadge>
          )}
          <KeyLine>{module.key}</KeyLine>
        </div>
        <p className="mt-1 max-w-prose text-body text-ink-2">
          {t.has(`descriptions.${module.key}`) ? t(`descriptions.${module.key}`) : t('noDescription')}
        </p>
        <p className="mt-1 text-hint text-muted-ink">
          {t('meta', { version: module.version })}
          {module.dependsOn.length > 0 ? ` · ${t('dependsOn', { list: module.dependsOn.join(', ') })}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <RefusalNotice action state={feedback.state} />
        <div className="flex items-center gap-2 text-meta font-semibold">
          <span>{module.locked ? t('locked') : module.enabled ? t('enabled') : t('disabled')}</span>
          <Switch
            checked={module.enabled}
            disabled={module.locked || pending}
            aria-label={t('toggle', { name })}
            onCheckedChange={(next) =>
              start(async () => {
                await feedback.run(() => setModuleEnabledAction(module.key, next));
              })
            }
          />
        </div>
        <span className="text-right text-hint text-muted-ink">
          {module.locked ? t('coreNote') : t.has(`notes.${module.key}`) ? t(`notes.${module.key}`) : ''}
        </span>
      </div>
    </section>
  );
}
