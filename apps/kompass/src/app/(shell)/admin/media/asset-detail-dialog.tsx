'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { kb, type Folder, type Item } from './types';

export function AssetDetailDialog({
  item,
  folders,
  currentFolder,
  onOpenChange,
  onMove,
  onDelete,
}: {
  item: Item | null;
  folders: Folder[];
  currentFolder: string | null;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, folder: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('media');
  const isImage = item?.mimeType.startsWith('image/') ?? false;

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {item ? (
          <>
            <DialogTitle className="truncate font-mono text-[14px]">{item.filename}</DialogTitle>

            <div className="grid place-items-center rounded-md border border-line bg-surface-2 p-3">
              {isImage ? (
                <img src={`/media/${item.id}`} alt="" className="max-h-[55vh] w-auto object-contain" />
              ) : (
                <span className="px-6 py-10 text-[24px] font-semibold uppercase text-ink-2">{item.filename.split('.').at(-1)}</span>
              )}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-2">{t('type')}</dt>
              <dd>{item.mimeType}</dd>
              <dt className="text-ink-2">{t('columns.size')}</dt>
              <dd>{kb(item.bytes)}</dd>
              {item.width && item.height ? (
                <>
                  <dt className="text-ink-2">{t('dimensions')}</dt>
                  <dd>
                    {item.width} × {item.height} px
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t('folder')}</dt>
              <dd>{currentFolder ?? t('root')}</dd>
              <dt className="text-ink-2">{t('uploadedAt')}</dt>
              <dd>{new Date(item.createdAt).toLocaleDateString('de-DE')}</dd>
              {item.uploadedBy ? (
                <>
                  <dt className="text-ink-2">{t('uploadedBy')}</dt>
                  <dd>{item.uploadedBy}</dd>
                </>
              ) : null}
              <dt className="text-ink-2">{t('columns.usage')}</dt>
              <dd>{item.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : item.references.join(', ')}</dd>
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 pt-3">
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                {t('move')}
                <select
                  value={currentFolder ?? ''}
                  className="rounded border border-line bg-input px-1 py-0.5 text-[13px]"
                  onChange={(e) => onMove(item.id, e.target.value || null)}
                >
                  <option value="">{t('root')}</option>
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={item.references.length > 0}
                title={item.references.length > 0 ? t('inUse') : undefined}
                onClick={() => onDelete(item.id)}
              >
                {t('delete')}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
