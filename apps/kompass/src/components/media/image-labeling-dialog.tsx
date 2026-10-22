'use client';

import type { AiKind } from '@kompass/core';
import { Brush, Sparkle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { getMediaLabelingAction, setMediaAiKindAction, type MediaLabelingInfo } from '@/app/(shell)/admin/media/actions';
import { UsageLines } from '@/app/(shell)/admin/media/usage-lines';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { runAction } from '@/lib/feedback';
import type { MediaListingItem } from '@/lib/media-listing';
import { AiKindBadge } from './ai-kind-badge';

/** Eine Datei für den Dialog: aus dem Hochladen (`created`) oder nachträglich (`created: true` heißt „fragen“). */
export type LabelingItem = { id: string; filename: string; mimeType: string; aiKind: AiKind; created: boolean };

/** Ein Bild, nach dem der Schritt fragt: kein PDF und keine Datei, die schon gekennzeichnet in der Mediathek lag. */
export const needsLabeling = (item: LabelingItem) => item.mimeType.startsWith('image/') && (item.created || item.aiKind === 'none');

/**
 * N2 (Freigabe Joe 2026-10-22): der Umschalter der Bildkennzeichnung, je Option Symbol und Wort wie die Marken —
 * Pinsel bei „Bearbeitet“, Funkeln bei „Mit KI erstellt“, „Keine“ ohne Symbol. Hier und im Detaildialog der Mediathek.
 */
export function AiKindSegmented({
  value,
  onValueChange,
  className,
  testId,
  ...aria
}: {
  value: AiKind;
  onValueChange: (next: AiKind) => void;
  className?: string;
  testId?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const tKind = useTranslations('media.aiKind');
  return (
    <Segmented
      {...aria}
      value={value}
      onValueChange={onValueChange}
      className={className}
      testId={testId}
      options={[
        { value: 'none', label: tKind('none') },
        {
          value: 'edited',
          label: (
            <>
              <Brush aria-hidden className="size-3.5" />
              {tKind('edited')}
            </>
          ),
        },
        {
          value: 'generated',
          label: (
            <>
              <Sparkle aria-hidden className="size-3.5" />
              {tKind('generated')}
            </>
          ),
        },
      ]}
    />
  );
}

/**
 * N1 (Freigabe Joe 2026-10-22): eine Zeile des Dialogs — Vorschau 64 px im Format 4:3 (Telefon 48 px), Dateiname,
 * Umschalter; am Telefon steht der Umschalter darunter über die volle Breite. Lag die Datei schon gekennzeichnet in der
 * Mediathek, steht statt des Umschalters die Marke. Der Grund einer Ablehnung steht unter der Zeile.
 */
function LabelingRow({ item, kind, error, hintId, onChange }: { item: LabelingItem; kind: AiKind; error: string | null; hintId: string; onChange: (next: AiKind) => void }) {
  const t = useTranslations('media.labeling');
  const nameId = useId();
  const errorId = useId();
  const labeled = !needsLabeling(item);
  return (
    <li data-testid="labeling-row" className="flex flex-col gap-2 border-b border-line-2 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-3 max-sm:flex-wrap">
        <img src={`/media/${item.id}/preview`} alt="" className="aspect-[4/3] w-16 shrink-0 rounded-sm border border-line object-cover max-sm:w-12" />
        <span id={nameId} className="min-w-0 flex-1 truncate text-meta text-ink">
          {item.filename}
        </span>
        {labeled ? (
          <span className="flex flex-col items-end gap-1 max-sm:w-full max-sm:items-start">
            <AiKindBadge kind={item.aiKind} />
            <span className="text-hint text-muted-ink">{t('alreadyLabeled')}</span>
          </span>
        ) : (
          <AiKindSegmented
            value={kind}
            onValueChange={onChange}
            aria-labelledby={nameId}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            className="max-sm:w-full max-sm:[&>*]:flex-1"
          />
        )}
      </div>
      {error ? (
        <div id={errorId}>
          <Notice level="refuse">{error}</Notice>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Dialog „Bildkennzeichnung“ (Spec Bildkennzeichnung beim Hochladen § 1–4): nach dem Hochladen mit allen Bildern des
 * Vorgangs, nachträglich (Fotokachel, Bildfeld) mit einem Bild und „Verwendet“. Jede Wahl speichert sofort über dieselbe
 * protokollierte Aktion wie der Detaildialog; scheitert sie, springt die Auswahl zurück. Kopf und Fuß stehen, die Liste
 * scrollt. Der Hinweis zur Schwelle steht einmal im Kopf, jeder Umschalter verweist darauf. Fuß: links ein Satz, rechts
 * ein Knopf, kein „Abbrechen“ — es gibt nichts zu verwerfen. × und Esc schließen nur (`onOpenChange`), `onConfirm`
 * gehört allein dem Knopf.
 */
export function ImageLabelingDialog({
  open,
  onOpenChange,
  items,
  description,
  usage,
  footer,
  confirmLabel,
  onConfirm,
  onLabeled,
  refusal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly LabelingItem[];
  description: ReactNode;
  /** Nachträglich: wo das Bild verwendet wird (`UsageLines`). */
  usage?: MediaListingItem['references'];
  footer: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onLabeled?: (id: string, aiKind: AiKind) => void;
  /** Ließ sich die Datei nicht lesen (nachträglich), steht der Grund statt der Zeile. */
  refusal?: string;
}) {
  const t = useTranslations('media.labeling');
  const tAi = useTranslations('media.aiKind');
  const tCommon = useTranslations('common');
  const hintId = useId();
  const images = items.filter((it) => it.mimeType.startsWith('image/'));
  const [kinds, setKinds] = useState<Record<string, AiKind>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Jedes Öffnen beginnt mit dem gespeicherten Stand der Dateien.
  const itemKey = items.map((it) => `${it.id}:${it.aiKind}`).join(',');
  useEffect(() => {
    if (!open) return;
    setKinds(Object.fromEntries(items.map((it) => [it.id, it.aiKind])));
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemKey]);

  const change = async (id: string, next: AiKind) => {
    const before = kinds[id] ?? 'none';
    setKinds((k) => ({ ...k, [id]: next }));
    setErrors(({ [id]: _drop, ...rest }) => rest);
    const state = await runAction(() => setMediaAiKindAction(id, next), tCommon('network'));
    if (state.status === 'error') {
      setKinds((k) => ({ ...k, [id]: before }));
      setErrors((e) => ({ ...e, [id]: state.message }));
      return;
    }
    onLabeled?.(id, next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="fixed-footer">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {/* Die Schwelle (Spec KI-Transparenz, Nachtrag 2026-10-22) einmal für alle Zeilen. */}
          <p id={hintId} className="text-hint text-muted-ink">
            {tAi('hint')}
          </p>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {refusal ? (
            <Notice level="refuse">{refusal}</Notice>
          ) : (
            <ul className="flex flex-col">
              {images.map((item) => (
                <LabelingRow key={item.id} item={item} kind={kinds[item.id] ?? item.aiKind} error={errors[item.id] ?? null} hintId={hintId} onChange={(next) => void change(item.id, next)} />
              ))}
            </ul>
          )}
          {usage && !refusal ? (
            <div className="flex flex-col gap-1 border-t border-line-2 pt-3 text-meta">
              <Overline field as="span">
                {t('usage')}
              </Overline>
              <UsageLines references={usage} />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-meta text-ink-2 max-sm:self-start">{footer}</span>
          <Button type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * „Kennzeichnen …“ nachträglich (Spec Bildkennzeichnung beim Hochladen § 4): an Fotokachel und Bildfeld. `open(id)` liest
 * Name, Art und Fundstellen und öffnet den Dialog mit einer Zeile und „Verwendet“; `dialog` gehört einmal in die
 * Aufrufstelle. `target` sagt, womit sonst gespeichert wird („dem Tier“); ohne ihn „dem Eintrag“.
 */
export function useLabelLater({ target, onLabeled }: { target?: string; onLabeled: (id: string, aiKind: AiKind) => void }) {
  const t = useTranslations('media.labeling');
  const tCrop = useTranslations('media.crop');
  const tCommon = useTranslations('common');
  const [state, setState] = useState<{ info: MediaLabelingInfo | null; refusal?: string } | null>(null);
  const open = async (id: string) => {
    const result = await runAction(() => getMediaLabelingAction(id), tCommon('network'));
    setState(result.status === 'success' ? { info: result.data as MediaLabelingInfo } : { info: null, refusal: result.status === 'error' ? result.message : undefined });
  };
  const close = () => setState(null);
  const info = state?.info;
  const dialog = (
    <ImageLabelingDialog
      open={state !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      items={info ? [{ id: info.id, filename: info.filename, mimeType: info.mimeType, aiKind: info.aiKind, created: true }] : []}
      description={t('later')}
      {...(info ? { usage: info.references } : {})}
      {...(state?.refusal ? { refusal: state.refusal } : {})}
      footer={t('laterFooter', { target: target || tCrop('targets.entry') })}
      confirmLabel={t('done')}
      onConfirm={close}
      onLabeled={onLabeled}
    />
  );
  return { open: (id: string) => void open(id), dialog };
}
