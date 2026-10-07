'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { DetailView } from '@/lib/site-job-view';
import { checkContentHashAction } from './actions';
import { hintCount } from './flow-state';

type Check = 'checking' | 'fresh' | 'stale';

/**
 * Die Rückfrage vor dem Publish. Beim Öffnen gleicht sie den Stand der Inhalte
 * mit der Vorschau ab (Sekunden, ohne Bilder zu kopieren): Stimmt er, steht
 * „Jetzt publizieren“ da, sonst „Vorschau neu bauen“. Es sind höchstens zwei
 * Knöpfe — drei passten nicht in die Fußzeile (Befund 6) —, und jeder Start
 * schließt zuerst den Dialog; den Lauf zeigt die Karte.
 */
export function PublishConfirmDialog({
  open,
  onOpenChange,
  env,
  publicUrl,
  preview,
  onPublish,
  onRebuild,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  env: string;
  publicUrl: string | null;
  preview: DetailView;
  onPublish(contentHash: string): void;
  onRebuild(): void;
}) {
  const t = useTranslations('site.publish.flow');
  const format = useFormatter();
  const [check, setCheck] = useState<Check>('checking');
  const [, startCheck] = useTransition();
  const hash = preview.contentHash ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCheck('checking');
    startCheck(async () => {
      const state = await checkContentHashAction();
      const fresh = state.status === 'success' ? (state.data as { contentHash: string }).contentHash : null;
      if (active) setCheck(hash !== null && fresh === hash ? 'fresh' : 'stale');
    });
    return () => {
      active = false;
    };
  }, [open, hash]);

  const host = (() => {
    try {
      return publicUrl ? new URL(publicUrl).host : '—';
    } catch {
      return publicUrl ?? '—';
    }
  })();
  const bold = { b: (chunks: React.ReactNode) => <strong>{chunks}</strong> };
  const label = env === 'test' ? t('publish.test') : t('publish.live');
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        // Der Fokus liegt auf der Hauptaktion der Leiste.
        initialFocus={() => document.querySelector<HTMLElement>('[data-testid="publish-confirm-main"]')}
        size="sm"
        className="bg-surface shadow-md"
      >
        <DialogTitle>{env === 'test' ? t('confirm.titleTest') : t('confirm.title', { host })}</DialogTitle>
        <DialogDescription tone="body">
          {check === 'stale'
            ? null
            : t.rich('confirm.text', {
                ...bold,
                changed: preview.counts.changed,
                added: preview.counts.added,
                removed: preview.counts.removed,
                hints: hintCount(preview),
              })}
        </DialogDescription>
        {check === 'stale' ? (
          <p role="alert" className="rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink">
            {t.rich('confirm.stale', { ...bold, time: format.dateTime(new Date(preview.finishedAt), { timeStyle: 'short' }) })}
          </p>
        ) : null}
        <p className="rounded-md border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
          {env === 'test' ? t('publish.test') : t('publish.live')} · {host}
        </p>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={close}
          saveTestId="publish-confirm-main"
          pending={check === 'checking'}
          saveLabel={check === 'stale' ? t('rebuild') : check === 'checking' ? t('confirm.checking') : label}
          onSave={() => {
            close();
            if (check === 'stale') onRebuild();
            else onPublish(hash!);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
