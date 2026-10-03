'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
  const main = useRef<HTMLButtonElement>(null);
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
        initialFocus={main}
        className="bg-surface shadow-md sm:max-w-[460px] max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none"
      >
        <DialogTitle className="font-heading text-[19px]">{env === 'test' ? t('confirm.titleTest') : t('confirm.title', { host })}</DialogTitle>
        <DialogDescription className="text-[14px] text-ink-2">
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
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t('confirm.cancel')}
          </Button>
          {check === 'stale' ? (
            <Button
              ref={main}
              onClick={() => {
                close();
                onRebuild();
              }}
            >
              {t('rebuild')}
            </Button>
          ) : (
            <Button
              ref={main}
              aria-busy={check === 'checking' || undefined}
              disabled={check === 'checking'}
              onClick={() => {
                close();
                onPublish(hash!);
              }}
            >
              {check === 'checking' ? t('confirm.checking') : label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
