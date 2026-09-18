'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatBytes, type Folder, type Item } from './types';
import { Select } from '@/components/ui/select';

export function AssetDetailDialog({
  item,
  folders,
  assetFolder,
  onOpenChange,
  onMove,
  onDelete,
}: {
  item: Item | null;
  folders: Folder[];
  assetFolder: string | null;
  onOpenChange: (open: boolean) => void;
  onMove: (id: string, folder: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('media');
  const fmt = useDateFormat();
  const isImage = item?.mimeType.startsWith('image/') ?? false;

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {item ? (
          <>
            <DialogTitle className="truncate font-mono text-[14px]">{item.filename}</DialogTitle>

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
              <dt className="text-ink-2">{t('folder')}</dt>
              <dd>{assetFolder ?? t('noFolder')}</dd>
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

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 pt-3">
              <a href={`/media/${item.id}`} target="_blank" rel="noopener" className="text-[13px] text-link underline">
                {t('open')}
              </a>
              <label className="flex items-center gap-2 text-[13px] text-ink-2">
                {t('move')}
                <Select
                  value={assetFolder ?? ''}
                  className="w-auto"
                  onChange={(e) => onMove(item.id, e.target.value || null)}
                >
                  <option value="">{t('noFolder')}</option>
                  {folders.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                    </option>
                  ))}
                </Select>
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
