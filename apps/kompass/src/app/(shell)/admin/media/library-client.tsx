'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { usePreference } from '@/lib/preferences';
import { AssetDetailDialog } from './asset-detail-dialog';
import { AssetGrid } from './asset-grid';
import { FolderTree } from './folder-tree';
import { kb, type Folder, type Item } from './types';
import { deleteMediaAction, moveMediaAction, uploadMediaAction } from './actions';

export function LibraryClient({ current, folders, items }: { current: string | null; folders: Folder[]; items: Item[] }) {
  const t = useTranslations('media');
  const router = useRouter();
  const [view, setView] = usePreference('mediaView');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, start] = useTransition();

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
      <FolderTree current={current} folders={folders} run={run} />

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            {t('upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
              className="text-[12px]"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.set('file', file);
                if (current) fd.set('folder', current);
                e.target.value = '';
                void run(uploadMediaAction(fd));
              }}
            />
          </label>
          <div className="flex overflow-hidden rounded-md border border-line text-[13px]">
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 ${view === v ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}
              >
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-ink-2">{t('empty')}</p>
        ) : view === 'grid' ? (
          <AssetGrid items={items} onOpen={(it) => setDetailId(it.id)} />
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-left text-ink-2">
              <tr>
                <th className="py-2">{t('columns.file')}</th>
                <th>{t('columns.size')}</th>
                <th>{t('columns.usage')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="h-[var(--row-h)] cursor-pointer border-b border-line-2 hover:bg-row-hover"
                  onClick={() => setDetailId(it.id)}
                >
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      {it.mimeType.startsWith('image/') ? (
                        <img src={`/media/${it.id}`} alt="" className="size-8 shrink-0 rounded border border-line object-cover" />
                      ) : (
                        <span className="grid size-8 shrink-0 place-items-center rounded border border-line bg-surface-2 text-[10px] uppercase text-ink-2">
                          {it.filename.split('.').at(-1)}
                        </span>
                      )}
                      <span className="font-mono text-[13px]">{it.filename}</span>
                    </span>
                  </td>
                  <td>{kb(it.bytes)}</td>
                  <td>{it.references.length === 0 ? <span className="text-ink-2">{t('unused')}</span> : it.references.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AssetDetailDialog
        item={detail}
        folders={folders}
        currentFolder={current}
        onOpenChange={(open) => !open && setDetailId(null)}
        onMove={move}
        onDelete={requestDelete}
      />

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
