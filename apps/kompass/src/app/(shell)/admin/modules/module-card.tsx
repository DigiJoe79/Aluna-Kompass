'use client';

import type { ModuleStatus } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Switch } from '@/components/ui/switch';
import { setModuleEnabledAction } from './actions';

export function ModuleCard({ module }: { module: ModuleStatus }) {
  const t = useTranslations('modules');
  const [pending, start] = useTransition();
  const name = t.has(`names.${module.key}`) ? t(`names.${module.key}`) : module.key;
  return (
    <section
      aria-label={name}
      className="grid grid-cols-[minmax(0,1fr)_190px] gap-4 rounded-lg border border-line bg-surface px-[18px] py-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-[17px]">{name}</h3>
          {module.locked ? (
            <StatusBadge tone="brand">{t('alwaysActive')}</StatusBadge>
          ) : (
            <StatusBadge tone={module.enabled ? 'success' : 'neutral'}>
              {module.enabled ? t('enabled') : t('disabled')}
            </StatusBadge>
          )}
          <span className="font-mono text-[11px] text-muted-ink">{module.key}</span>
        </div>
        <p className="mt-1 max-w-[640px] text-[14px] leading-[1.5] text-ink-2">
          {t.has(`descriptions.${module.key}`) ? t(`descriptions.${module.key}`) : t('noDescription')}
        </p>
        <p className="mt-1 text-[12px] text-muted-ink">
          {t('meta', { version: module.version })}
          {module.dependsOn.length > 0 ? ` · ${t('dependsOn', { list: module.dependsOn.join(', ') })}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span>{module.locked ? t('locked') : module.enabled ? t('enabled') : t('disabled')}</span>
          <Switch
            checked={module.enabled}
            disabled={module.locked || pending}
            aria-label={t('toggle', { name })}
            onCheckedChange={(next) =>
              start(async () => {
                const s = await setModuleEnabledAction(module.key, next);
                if (s.status === 'error') toast.error(s.message);
                else toast.success(s.status === 'success' ? s.message ?? '' : '');
              })
            }
          />
        </div>
        <span className="text-right text-[11px] text-muted-ink">
          {module.locked ? t('coreNote') : t.has(`notes.${module.key}`) ? t(`notes.${module.key}`) : ''}
        </span>
      </div>
    </section>
  );
}
