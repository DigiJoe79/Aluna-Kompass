'use client';

import type { LocaleRemovalPreview } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { SubmitButton } from '@/components/forms/submit-button';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { addLocaleAction, previewLocaleRemovalAction, removeLocaleAction, reorderLocalesAction } from './actions';

export function LocalesClient({ locales }: { locales: string[] }) {
  const t = useTranslations('admin.locales');
  const [state, action] = useActionState(addLocaleAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  const [toRemove, setToRemove] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocaleRemovalPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      formRef.current?.reset();
    } else if (state.status === 'error' && Object.keys(errors).length === 0) {
      toast.error(state.message);
    }
  }, [state, errors]);

  const openRemove = async (code: string) => {
    setToRemove(code);
    setLoadingPreview(true);
    setPreview(null);
    const res = await previewLocaleRemovalAction(code);
    if (res.ok) {
      setPreview(res.value);
    } else {
      toast.error(res.error.type === 'conflict' ? res.error.message : 'Fehler');
      setToRemove(null);
    }
    setLoadingPreview(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line bg-table-head px-6 py-3 text-[13px] font-semibold text-muted-ink">
          {t('title')} ({locales.length})
        </div>
        <ul role="list" className="divide-y divide-line-2">
          {locales.map((code, index) => (
            <li
              key={code}
              role="listitem"
              className={`flex h-[52px] items-center justify-between px-6 hover:bg-row-hover ${
                index % 2 === 1 ? 'bg-zebra' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[15px] font-semibold text-ink">{code}</span>
                {index === 0 ? <StatusBadge tone="neutral">{t('leading')}</StatusBadge> : null}
              </div>
              <div className="flex items-center gap-2">
                <ReorderButtons ids={locales} index={index} action={reorderLocalesAction} />
                {locales.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:bg-error-bg hover:text-error"
                    aria-label={t('remove', { code })}
                    onClick={() => openRemove(code)}
                  >
                    {t('remove', { code })}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6">
        <h3 className="mb-4 font-heading text-[17px] text-ink">{t('add')}</h3>
        <form ref={formRef} action={action} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FormField id="code" label={t('code')} hint={t('codeHint')} error={errors.code}>
              <Input
                id="code"
                name="code"
                placeholder="z. B. fr"
                required
                pattern="[a-z]{2}(-[a-z]{2})?"
                className="font-mono"
              />
            </FormField>
          </div>
          <div>
            <SubmitButton>{t('add')}</SubmitButton>
          </div>
        </form>
      </div>

      <ConfirmDialog
        role="dialog"
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToRemove(null);
            setPreview(null);
          }
        }}
        title={t('removeTitle', { code: toRemove ?? '' })}
        description={
          loadingPreview
            ? '...'
            : preview
              ? t('removeWarning', { count: preview.filled, locale: toRemove ?? '' })
              : ''
        }
        confirmLabel={t('removeConfirm')}
        destructive
        confirmDisabled={loadingPreview || preview === null}
        action={async () => {
          if (!toRemove) return idleState;
          const res = await removeLocaleAction(toRemove);
          setToRemove(null);
          setPreview(null);
          return res;
        }}
      />
    </div>
  );
}
