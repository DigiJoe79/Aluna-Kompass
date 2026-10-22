'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FolderField } from '@/components/folder-tree/folder-field';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { buttonVariants } from '@/components/ui/button';
import { RecordActions } from '@/components/record-actions';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { AiKindBadge } from '@/components/media/ai-kind-badge';
import { AiKindSegmented } from '@/components/media/image-labeling-dialog';
import type { ActionState } from '@/lib/actions';
import type { FolderEntry } from '@/lib/folder-tree-model';
import type { AiKind } from '@kompass/core';
import { formatBytes, mimeKey, type Item } from './types';
import { UsageLines } from './usage-lines';

/**
 * Eine Datei der Mediathek im Detail. Der Ort steht als Weg mit „Verschieben
 * nach…“ (HANDOFF § 3.5, README § 3 Artboard 5): verschoben wird über
 * denselben Weg wie beim Ziehen — Toast mit „Rückgängig“ —; lehnt der Server
 * ab, bleibt der Dialog offen und nennt den Grund.
 *
 * „Löschen …“ steht links im Fuß (Aktion am Datensatz, Spec Seitenkopf § 3.3). Die Rückfrage ist ein Dialog im Dialog,
 * damit der Fokus nach dem Schließen auf „Löschen …“ zurückkehrt; wird die Datei noch verwendet, nennt sie den Grund
 * statt zu löschen (keine Sperre ohne Grund).
 */
export function AssetDetailDialog({
  item,
  folders,
  assetFolder,
  onOpenChange,
  onMove,
  onDelete,
  onCreateFolder,
  aiLabelingEnabled = false,
  onSetAiKind,
}: {
  item: Item | null;
  /** Die Ordner wie im Baum, samt noch nicht bestätigter Züge. */
  folders: FolderEntry[];
  assetFolder: string | null;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, folder: string | null) => Promise<ActionState>;
  /** Legt einen Ordner an (die Mediathek verlangt `media.upload`, das Recht für Ordner); im Feld „Neuer Ordner in …“. */
  onCreateFolder?: (parent: string | null, name: string) => Promise<ActionState>;
  /** Löscht nach der Rückfrage; bei Erfolg schließt der Aufrufer den Detaildialog. */
  onDelete: (id: string) => Promise<ActionState>;
  aiLabelingEnabled?: boolean;
  onSetAiKind?: (id: string, aiKind: AiKind) => Promise<ActionState>;
}) {
  const t = useTranslations('media');
  const fmt = useDateFormat();
  const isImage = item?.mimeType.startsWith('image/') ?? false;
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [aiKind, setAiKind] = useState<AiKind>(item?.aiKind ?? 'none');
  const [aiKindError, setAiKindError] = useState<string | null>(null);
  const aiKindLabelId = useId();
  const aiKindHintId = useId();

  // Ein anderes Element im Dialog beginnt ohne offene Rückfrage.
  const itemId = item?.id;
  const itemAiKind = item?.aiKind;
  useEffect(() => {
    setConfirming(false);
    setAiKindError(null);
    if (itemId) setAiKind(itemAiKind ?? 'none');
  }, [itemId, itemAiKind]);

  // Gespeichert wird sofort; scheitert es, springt die Auswahl zurück und der Grund steht darunter.
  const handleAiKindChange = async (next: AiKind) => {
    if (!onSetAiKind || !item) return;
    const before = aiKind;
    setAiKind(next);
    setAiKindError(null);
    const state = await onSetAiKind(item.id, next);
    if (state.status === 'error') {
      setAiKind(before);
      setAiKindError(state.message);
    }
  };

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      {/* Höchstens so hoch wie der Bildschirm, sonst scrollt der Dialog: Mit Vorschau, Bildkennzeichnung und aufgeklapptem
          Ordnerbaum lag der Baum bei 800 px Höhe unter dem Rand und war nicht anklickbar (2026-10-20). */}
      <DialogContent size="md" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {item ? (
          <>
            <DialogTitle className="truncate text-body">{item.filename}</DialogTitle>

            <div className="relative grid place-items-center rounded-md border border-line bg-surface-2 p-3">
              {isImage ? (
                <>
                  <img src={`/media/${item.id}/preview`} alt="" className="max-h-[55vh] w-auto object-contain" />
                  {aiLabelingEnabled && aiKind !== 'none' ? (
                    <span className="absolute top-2 right-2">
                      <AiKindBadge kind={aiKind} />
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="px-6 py-10 text-[24px] font-semibold uppercase text-ink-2">{item.filename.split('.').at(-1)}</span>
              )}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
              <dt className="text-ink-2">{t('type')}</dt>
              <dd>{mimeKey(item.mimeType) ? t(`mimeTypes.${mimeKey(item.mimeType)!}`) : item.mimeType}</dd>
              <dt className="text-ink-2">{t('columns.size')}</dt>
              <dd>{formatBytes(item.bytes)}</dd>
              {item.width && item.height ? (
                <>
                  <dt className="text-ink-2">{t('dimensions')}</dt>
                  <dd>
                    {item.width} × {item.height} px
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t('uploadedAt')}</dt>
              <dd>{fmt.date(item.createdAt)}</dd>
              {item.uploadedBy ? (
                <>
                  <dt className="text-ink-2">{t('uploadedBy')}</dt>
                  <dd>{item.uploadedBy}</dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t('columns.usage')}</dt>
              <dd>
                <UsageLines references={item.references} linked />
              </dd>
            </dl>

            {aiLabelingEnabled && isImage ? (
              <div className="flex flex-col gap-1.5 border-t border-line-2 pt-3">
                <Overline field as="span"><span id={aiKindLabelId}>{t('aiKind.label')}</span></Overline>
                <AiKindSegmented aria-labelledby={aiKindLabelId} aria-describedby={aiKindHintId} value={aiKind} onValueChange={handleAiKindChange} testId="ai-kind-segmented" />
                {/* Die Schwelle (Spec KI-Transparenz, Nachtrag 2026-10-22): Kompass prüft sie nicht, der Mensch entscheidet. */}
                <p id={aiKindHintId} className="text-hint text-muted-ink">{t('aiKind.hint')}</p>
                {aiKindError ? <Notice level="refuse">{aiKindError}</Notice> : null}
              </div>
            ) : null}

            <FolderField
              value={assetFolder}
              folders={folders}
              label={t('folder')}
              emptyLabel={t('noFolder')}
              kind="assets"
              onChange={(target) => onMove(item.id, target)}
              onCreate={onCreateFolder}
            />

            {/* Wie der Fuß der `FormActionBar`: Aktion am Datensatz links, „Öffnen“ rechts. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 pt-3">
              <RecordActions single="button" triggerRef={trigger} actions={[{ key: 'delete', label: t('deleteItem'), kind: 'delete', onSelect: () => setConfirming(true), testId: 'media-delete-trigger' }]} />
              {/* 146: „Öffnen“ als `outline`-Knopf, nicht als Link im Fuß. */}
              <a href={`/media/${item.id}`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline' })}>
                {t('open')}
              </a>
            </div>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              finalFocus={trigger}
              title={t('confirmDelete')}
              description={t('confirmDeleteBody')}
              confirmLabel={t('delete')}
              destructive
              refusal={item.references.length > 0 ? { message: t('inUseRefusal', { places: item.references.map((r) => r.label).join(', ') }) } : undefined}
              action={() => onDelete(item.id)}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
