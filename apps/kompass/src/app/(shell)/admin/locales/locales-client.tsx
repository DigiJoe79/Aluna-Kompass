'use client';

import type { LocaleRemovalPreview } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { SubmitButton } from '@/components/forms/submit-button';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { idleState, type ActionState } from '@/lib/actions';
import { addLocaleAction, previewLocaleRemovalAction, removeLocaleAction, reorderLocalesAction } from './actions';

export function LocalesClient({ locales }: { locales: string[] }) {
  const t = useTranslations('admin.locales');
  const [state, action] = useActionState(addLocaleAction, idleState);
  const formRef = useRef<HTMLFormElement>(null);
  // `useMemo`, weil `errors` sonst bei jedem Render ein neues Objekt waere und
  // der Effekt unten damit bei jedem Render feuerte statt nur bei einer
  // Zustandsaenderung — der Toast erschiene mehrfach.
  const errors = useMemo(() => (state.status === 'error' ? state.fieldErrors : {}), [state]);

  const [toRemove, setToRemove] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocaleRemovalPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // „Entfernen“ steht in den Zeilen der Liste: Die Ablehnung steht über der Liste.
  const [removeRefusal, setRemoveRefusal] = useState<ActionState>({ status: 'idle' });

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message ?? '');
      formRef.current?.reset();
    }
  }, [state]);

  const openRemove = async (code: string) => {
    setToRemove(code);
    setRemoveRefusal({ status: 'idle' });
    setLoadingPreview(true);
    setPreview(null);
    const res = await previewLocaleRemovalAction(code);
    if (res.status === 'success') {
      setPreview(res.data as LocaleRemovalPreview);
    } else {
      setRemoveRefusal(res);
      setToRemove(null);
    }
    setLoadingPreview(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <RefusalNotice action state={removeRefusal} />
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

      <div className="rounded-lg border border-line bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">{t('add')}</h3>
        <div className="mt-3">
          <RefusalNotice state={state} />
        </div>
        <form ref={formRef} action={action} className="mt-3">
          <FormGrid>
            <FormField id="code" label={t('code')} hint={t('codeHint')} error={errors.code} size="s">
              <Input
                id="code"
                name="code"
                placeholder={t('codePlaceholder')}
                required
                pattern="[a-z]{2}(-[a-z]{2})?"
                className="font-mono"
              />
            </FormField>
            <div className="self-end">
              <SubmitButton>{t('add')}</SubmitButton>
            </div>
          </FormGrid>
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
          // Nur bei Erfolg: Eine Ablehnung hält den Dialog offen.
          if (res.status === 'success') {
            setToRemove(null);
            setPreview(null);
          }
          return res;
        }}
      />
    </div>
  );
}
