'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FolderField } from '@/components/folder-tree/folder-field';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RecordActions } from '@/components/record-actions';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/actions';
import type { FolderEntry } from '@/lib/folder-tree-model';
import { formatBytes, type Item } from './types';

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
}: {
  item: Item | null;
  /** Die Ordner wie im Baum, samt noch nicht bestätigter Züge. */
  folders: FolderEntry[];
  assetFolder: string | null;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, folder: string | null) => Promise<ActionState>;
  /** Löscht nach der Rückfrage; bei Erfolg schließt der Aufrufer den Detaildialog. */
  onDelete: (id: string) => Promise<ActionState>;
}) {
  const t = useTranslations('media');
  const tMove = useTranslations('moveDialog');
  const fmt = useDateFormat();
  const isImage = item?.mimeType.startsWith('image/') ?? false;
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Ein anderes Element im Dialog beginnt ohne offene Rückfrage.
  useEffect(() => setConfirming(false), [item?.id]);

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {item ? (
          <>
            <DialogTitle className="truncate font-mono text-[14px] font-medium">{item.filename}</DialogTitle>

            <div className="grid place-items-center rounded-md border border-line bg-surface-2 p-3">
              {isImage ? (
                <img src={`/media/${item.id}/preview`} alt="" className="max-h-[55vh] w-auto object-contain" />
              ) : (
                <span className="px-6 py-10 text-[24px] font-semibold uppercase text-ink-2">{item.filename.split('.').at(-1)}</span>
              )}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-2">{t('type')}</dt>
              <dd>{item.mimeType}</dd>
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
                {item.references.length === 0 ? (
                  <span className="text-ink-2">{t('unused')}</span>
                ) : (
                  item.references.map((r, i) => (
                    <span key={`${r.label}-${i}`}>
                      {i > 0 ? ', ' : null}
                      {r.href ? (
                        <Link href={r.href} className="text-link underline">
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </span>
                  ))
                )}
              </dd>
            </dl>

            <FolderField
              value={assetFolder}
              folders={folders}
              label={t('folder')}
              emptyLabel={t('noFolder')}
              dialogTitle={tMove('titleOne', { title: item.filename })}
              kind="assets"
              onChange={(target) => onMove(item.id, target)}
            />

            {/* Wie der Fuß der `FormActionBar`: Aktion am Datensatz links, „Öffnen“ rechts. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 pt-3">
              <RecordActions single="button" triggerRef={trigger} actions={[{ key: 'delete', label: t('deleteItem'), kind: 'delete', onSelect: () => setConfirming(true), testId: 'media-delete-trigger' }]} />
              <a href={`/media/${item.id}`} target="_blank" rel="noopener" className="text-[13px] text-link underline">
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
