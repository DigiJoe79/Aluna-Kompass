'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { AssetGrid } from '@/components/media/asset-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { usePreference } from '@/lib/preferences';
import { AssetDetailDialog } from './asset-detail-dialog';
import { FolderTree } from './folder-tree';
import { formatBytes, type Folder, type Item, type ListQuery } from './types';
import { deleteMediaAction, moveMediaAction, uploadMediaAction } from './actions';

const KINDS = ['all', 'image', 'pdf'] as const;
const SORTS = ['newest', 'oldest', 'name', 'size'] as const;

export function LibraryClient({ query, folders, items }: { query: ListQuery; folders: Folder[]; items: Item[] }) {
  const t = useTranslations('media');
  const fmt = useDateFormat();
  const router = useRouter();
  const [view, setView] = usePreference('mediaView');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, start] = useTransition();
  const current = query.folder;

  const detail = items.find((it) => it.id === detailId) ?? null;

  const run = async (p: Promise<ActionState>) => {
    const s = await p;
    if (s.status === 'error') toast.error(s.message);
    else if (s.status === 'success') {
      if (s.message) toast.success(s.message);
      start(() => router.refresh());
    }
    return s;
  };

  const move = async (id: string, folder: string | null) => {
    const s = await run(moveMediaAction(id, folder));
    if (s.status === 'success') setDetailId(null);
  };

  const requestDelete = (id: string) => {
    setDetailId(null);
    setConfirmId(id);
  };

  return (
    <div className="flex gap-6">
      <FolderTree query={query} folders={folders} run={run} />

      <div className="min-w-0 flex-1">
        <form method="get" action="/admin/media" className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
          {current !== null ? <input type="hidden" name="folder" value={current} /> : null}
          <Input type="search" name="q" defaultValue={query.q} placeholder={t('searchPlaceholder')} aria-label={t('search')} className="min-w-0 flex-1" />
          <label className="flex items-center gap-2 text-ink-2">
            {t('kind.label')}
            <Select name="kind" defaultValue={query.kind} className="w-auto">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-ink-2">
            {t('sort.label')}
            <Select name="sort" defaultValue={query.sort} className="w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t('filter')}
          </Button>
        </form>

        <div className="mb-4 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            {t('upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
              className="text-[12px]"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.set('file', file);
                if (current) fd.set('folder', current);
                e.target.value = '';
                setUploading(true);
                void run(uploadMediaAction(fd)).finally(() => setUploading(false));
              }}
            />
            {uploading ? <span aria-live="polite">{t('uploading')}</span> : null}
          </label>
          <div className="flex overflow-hidden rounded-md border border-line text-[13px]">
            {(['list', 'grid'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} text={t('empty')} />
        ) : view === 'grid' ? (
          <AssetGrid items={items.map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0 }))} onOpen={(it) => setDetailId(it.id)} />
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-left text-ink-2">
              <tr>
                <th className="py-2">{t('columns.file')}</th>
                <th>{t('columns.folder')}</th>
                <th>{t('columns.size')}</th>
                <th>{t('columns.uploadedAt')}</th>
                <th>{t('columns.usage')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="h-[var(--row-h)] cursor-pointer border-b border-line-2 hover:bg-row-hover" onClick={() => setDetailId(it.id)}>
                  <td className="py-2">
                    <button type="button" className="flex items-center gap-2 text-left" onClick={(e) => { e.stopPropagation(); setDetailId(it.id); }}>
                      {it.mimeType.startsWith('image/') ? (
                        <img src={`/media/${it.id}/preview`} alt="" loading="lazy" className="size-8 shrink-0 rounded border border-line object-cover" />
                      ) : (
                        <span className="grid size-8 shrink-0 place-items-center rounded border border-line bg-surface-2 text-[10px] uppercase text-ink-2">{it.filename.split('.').at(-1)}</span>
                      )}
                      <span className="font-mono text-[13px]">{it.filename}</span>
                    </button>
                  </td>
                  <td className="text-ink-2">{it.folder ?? t('noFolder')}</td>
                  <td>{formatBytes(it.bytes)}</td>
                  <td className="text-ink-2">{fmt.date(it.createdAt)}</td>
                  <td>{it.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : it.references.map((r) => r.label).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AssetDetailDialog item={detail} folders={folders} assetFolder={detail?.folder ?? null} onOpenChange={(open) => !open && setDetailId(null)} onMove={move} onDelete={requestDelete} />

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title={t('confirmDelete')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('delete')}
        destructive
        action={async () => {
          if (!confirmId) return { status: 'idle' } as ActionState;
          const state = await deleteMediaAction(confirmId);
          if (state.status === 'success') start(() => router.refresh());
          setConfirmId(null);
          return state;
        }}
      />
    </div>
  );
}
