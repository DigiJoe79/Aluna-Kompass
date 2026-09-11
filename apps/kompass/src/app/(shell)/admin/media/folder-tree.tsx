'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { createFolderAction, deleteFolderAction, renameFolderAction } from './actions';
import type { Folder } from './types';
import { Input } from '@/components/ui/input';

const folderHref = (path: string | null) => (path === null ? '/admin/media' : `/admin/media?folder=${encodeURIComponent(path)}`);

export function FolderTree({
  current,
  folders,
  run,
}: {
  current: string | null;
  folders: Folder[];
  run: (p: Promise<ActionState>) => Promise<ActionState>;
}) {
  const t = useTranslations('media');
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [renameTo, setRenameTo] = useState<string | null>(null);

  return (
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
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('newFolderName')}
          aria-label={t('newFolderName')}
          className="min-w-0 flex-1"
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
            className="self-start text-error underline"
            onClick={() => void run(deleteFolderAction(current)).then((s) => s.status === 'success' && router.push('/admin/media'))}
          >
            {t('deleteFolder')}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
