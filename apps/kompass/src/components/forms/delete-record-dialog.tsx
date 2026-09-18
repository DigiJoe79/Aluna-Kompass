'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { ActionState } from '@/lib/actions';
import type { DeletionPreviewView } from '@/lib/deletion-preview';

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; preview: DeletionPreviewView };

/**
 * Löschen in zwei Stufen, für alles mit Veröffentlicht-Schalter. Der Dialog
 * fragt beim Öffnen den Dienst, ob gelöscht werden darf — dieselbe Funktion,
 * die der Löschdienst selbst benutzt. Er zeigt deshalb nie „frei“, wo der
 * Dienst ablehnen würde; lehnt der Dienst trotzdem ab (jemand hat inzwischen
 * einen Bezug gesetzt), steht der Grund im Toast.
 */
export function DeleteRecordDialog({
  open,
  onOpenChange,
  title,
  loadPreview,
  unpublish,
  remove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loadPreview: () => Promise<DeletionPreviewView | null>;
  unpublish?: () => Promise<ActionState>;
  remove: (deleteOrphanedMedia: boolean) => Promise<ActionState>;
}) {
  const t = useTranslations('deletion');
  const format = useDateFormat();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [withMedia, setWithMedia] = useState(true);
  const [pending, start] = useTransition();

  const load = () => {
    setLoaded({ state: 'loading' });
    void loadPreview().then((preview) => setLoaded(preview ? { state: 'ready', preview } : { state: 'failed' }));
  };
  // Je Öffnen frisch: Zwischen zwei Öffnungen kann jemand einen Bezug gesetzt oder gelöst haben.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setWithMedia(true); load(); } }, [open]);

  const preview = loaded.state === 'ready' ? loaded.preview : null;
  const free = !!preview && !preview.isPublished && preview.blockers.length === 0;
  const offerMedia = free && preview.canDeleteMedia && preview.exclusiveMedia > 0;
  const description = loaded.state === 'loading' ? t('loading') : loaded.state === 'failed' ? t('failed') : preview!.isPublished ? t('published') : preview!.blockers.length > 0 ? t('blocked') : t('confirm');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={t('delete')}
      destructive
      confirmDisabled={!free}
      action={() => remove(offerMedia && withMedia)}
    >
      {preview?.isPublished && unpublish ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => {
              const state = await unpublish();
              if (state.status === 'error') toast.error(state.message);
              else load();
            })}
          >
            {t('unpublish')}
          </Button>
        </div>
      ) : null}

      {preview && !preview.isPublished && preview.blockers.length > 0 ? (
        <div className="text-[14px] text-ink-2">
          <ul className="list-disc pl-5">
            {preview.blockers.map((b) => {
              const text = b.until === undefined ? b.label : b.until === null ? t('heldPermanently', { label: b.label }) : t('heldUntil', { label: b.label, date: format.date(b.until) });
              return <li key={`${b.label}-${b.href ?? ''}`}>{b.href ? <Link href={b.href} className="text-link underline">{text}</Link> : text}</li>;
            })}
          </ul>
          <p className="mt-2 text-[13px] text-muted-ink">{t('blockedHint')}</p>
        </div>
      ) : null}

      {offerMedia ? (
        <label className="flex items-center gap-2 text-[14px]">
          <Checkbox checked={withMedia} onCheckedChange={(next) => setWithMedia(next === true)} />
          <span>{t('withMedia', { count: preview.exclusiveMedia })}</span>
        </label>
      ) : null}

      {free && preview.sharedMedia.length > 0 ? (
        <ul className="text-[13px] text-muted-ink">
          {preview.sharedMedia.map((m) => (
            <li key={m.filename}>{t('sharedMedia', { places: m.usedElsewhere.join(', ') })} {m.filename}</li>
          ))}
        </ul>
      ) : null}
    </ConfirmDialog>
  );
}
