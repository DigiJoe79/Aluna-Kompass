'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import {
  createFolderAction,
  deleteFolderAction,
  deleteMediaAction,
  moveMediaAction,
  renameFolderAction,
  uploadMediaAction,
} from './actions';

interface Item {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  references: string[];
}
interface Folder {
  path: string;
  assetCount: number;
}

const kb = (b: number) => `${Math.max(1, Math.round(b / 1024))} KB`;

export function LibraryClient({ current, folders, items }: { current: string | null; folders: Folder[]; items: Item[] }) {
  const t = useTranslations('media');
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [, start] = useTransition();

  const run = async (p: Promise<ActionState>) => {
    const s = await p;
    if (s.status === 'error') toast.error(s.message);
    else if (s.status === 'success') {
      if (s.message) toast.success(s.message);
      start(() => router.refresh());
    }
    return s;
  };

  const folderHref = (path: string | null) => (path === null ? '/admin/media' : `/admin/media?folder=${encodeURIComponent(path)}`);

  return (
    <div className="flex gap-6">
      <nav className="w-60 shrink-0 text-[14px]">
        <a href={folderHref(null)} className={`block rounded px-2 py-1 ${current === null ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
          {t('root')}
        </a>
        {folders.map((f) => (
          <a
            key={f.path}
            href={folderHref(f.path)}
            className={`block rounded px-2 py-1 ${current === f.path ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}
            style={{ paddingLeft: `${0.5 + (f.path.split('/').length - 1) * 0.75}rem` }}
          >
            {f.path.split('/').at(-1)} <span className="text-ink-2">({f.assetCount})</span>
          </a>
        ))}

        <form
          className="mt-3 flex gap-1 border-t border-line-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            void run(createFolderAction(current ? `${current}/${name}` : name)).then((s) => s.status === 'success' && setNewName(''));
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('newFolderName')}
            aria-label={t('newFolderName')}
            className="min-w-0 flex-1 rounded border border-line bg-input px-2 py-1 text-[13px]"
          />
          <Button type="submit" size="sm" variant="ghost" disabled={newName.trim() === ''}>
            {t('newFolder')}
          </Button>
        </form>

        {current !== null ? (
          <div className="mt-2 flex flex-col gap-2 text-[13px]">
            {renameTo === null ? (
              <button type="button" className="self-start text-link underline" onClick={() => setRenameTo(current.split('/').at(-1) ?? '')}>
                {t('renameFolder')}
              </button>
            ) : (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const seg = renameTo.trim();
                  if (!seg) return;
                  const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : '';
                  void run(renameFolderAction(current, parent + seg)).then((s) => {
                    if (s.status === 'success') {
                      setRenameTo(null);
                      router.push(folderHref(parent + seg));
                    }
                  });
                }}
              >
                <input
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.target.value)}
                  aria-label={t('renameFolder')}
                  className="min-w-0 flex-1 rounded border border-line bg-input px-2 py-1"
                />
                <Button type="submit" size="sm" variant="ghost">
                  {t('renameFolder')}
                </Button>
              </form>
            )}
            <button
              type="button"
              className="self-start text-error underline disabled:opacity-50"
              onClick={() => void run(deleteFolderAction(current)).then((s) => s.status === 'success' && router.push('/admin/media'))}
            >
              {t('deleteFolder')}
            </button>
          </div>
        ) : null}
      </nav>

      <div className="min-w-0 flex-1">
        <label className="mb-4 flex items-center gap-2 text-[13px] text-ink-2">
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
        {items.length === 0 ? (
          <p className="text-ink-2">{t('empty')}</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead className="text-left text-ink-2">
              <tr>
                <th className="py-2">{t('columns.file')}</th>
                <th>{t('columns.size')}</th>
                <th>{t('columns.usage')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="h-[var(--row-h)] border-b border-line-2">
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
                  <td className="whitespace-nowrap text-right">
                    <select
                      aria-label={t('move')}
                      value={current ?? ''}
                      className="mr-2 rounded border border-line bg-input px-1 py-0.5 text-[13px]"
                      onChange={(e) => void run(moveMediaAction(it.id, e.target.value || null))}
                    >
                      <option value="">{t('root')}</option>
                      {folders.map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.path}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={it.references.length > 0}
                      title={it.references.length > 0 ? t('inUse') : undefined}
                      onClick={() => setConfirmId(it.id)}
                    >
                      {t('delete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
