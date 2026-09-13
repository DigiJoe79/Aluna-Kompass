'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadMediaAction } from '@/app/(shell)/admin/media/actions';
import { flattenFolderTree } from '@/app/(shell)/admin/media/folder-tree-model';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { MediaListing } from '@/lib/media-listing';
import { usePreference } from '@/lib/preferences';
import { AssetGrid } from './asset-grid';

export interface MediaChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Was das Feld nimmt — der Dialog zeigt nur das. */
  kind: 'image' | 'pdf';
  multiple: boolean;
  /** Bereits gewählte IDs; bei multiple vorab angehakt, bei single nur markiert. */
  selected: string[];
  onConfirm: (ids: string[]) => void;
}

const ACCEPT = { image: 'image/png,image/jpeg,image/webp,image/svg+xml', pdf: 'application/pdf' } as const;
type Sort = 'newest' | 'oldest' | 'name' | 'size';
const SORTS: Sort[] = ['newest', 'oldest', 'name', 'size'];

/**
 * Die Mediathek in klein: Ordner links, Kacheln rechts, Suche und Upload oben.
 * Einzelauswahl: Klick auf die Kachel übernimmt sofort. Mehrfachauswahl: Häkchen
 * und „Übernehmen“. Ein Upload landet im offenen Ordner und wird ausgewählt.
 */
export function MediaChooserDialog({ open, onOpenChange, kind, multiple, selected, onConfirm }: MediaChooserDialogProps) {
  const t = useTranslations('media');
  const [folder, setFolder] = usePreference('mediaChooserFolder');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [listing, setListing] = useState<MediaListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Beim Öffnen den Stand des Feldes übernehmen.
  useEffect(() => {
    if (open) setPicked(new Set(selected));
  }, [open, selected]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (folder !== null) params.set('folder', folder);
    if (query.trim()) params.set('query', query.trim());
    params.set('kind', kind);
    params.set('sort', sort);
    try {
      const res = await fetch(`/media?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setListing((await res.json()) as MediaListing);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [folder, query, kind, sort]);

  // Laden beim Öffnen und bei jeder Änderung; die Suche entprellt.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [open, load, query]);

  const tree = useMemo(() => flattenFolderTree(listing?.folders ?? []), [listing]);
  const items = useMemo(() => (listing?.items ?? []).map((it) => ({ id: it.id, filename: it.filename, mimeType: it.mimeType, used: it.references.length > 0 })), [listing]);

  const choose = (id: string) => {
    if (!multiple) {
      onConfirm([id]);
      onOpenChange(false);
      return;
    }
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      let last: string | null = null;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set('file', file);
        if (folder) fd.set('folder', folder);
        const state = await uploadMediaAction(fd);
        if (state.status === 'error') {
          toast.error(state.message);
          continue;
        }
        if (state.status === 'success') {
          const data = state.data as { id: string; created: boolean };
          if (!data.created && state.message) toast.info(state.message);
          last = data.id;
          if (multiple) setPicked((p) => new Set(p).add(data.id));
        }
      }
      await load();
      if (!multiple && last) {
        onConfirm([last]);
        onOpenChange(false);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const title = multiple ? t('chooser.titleMultiple') : kind === 'pdf' ? t('chooser.titlePdf') : t('chooser.titleImage');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle>{title}</DialogTitle>

        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="min-w-0 flex-1"
          />
          <label className="flex items-center gap-2 text-ink-2">
            {t('sort.label')}
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-ink-2">
            {t('chooser.upload')}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT[kind]}
              multiple
              disabled={uploading}
              aria-label={t('chooser.upload')}
              className="text-[12px]"
              onChange={(e) => e.target.files && e.target.files.length > 0 && void upload(e.target.files)}
            />
            {uploading ? <span aria-live="polite">{t('uploading')}</span> : null}
          </label>
        </div>

        <div className="flex gap-4">
          <nav className="w-48 shrink-0 text-[13px]" aria-label={t('folder')}>
            <button type="button" onClick={() => setFolder(null)} className={`block w-full rounded px-2 py-1 text-left ${folder === null ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}>
              {t('root')}
            </button>
            {tree.map((node) => (
              <button
                key={node.path}
                type="button"
                onClick={() => setFolder(node.path)}
                className={`block w-full rounded px-2 py-1 text-left ${folder === node.path ? 'bg-selected text-selected-ink' : 'hover:bg-row-hover'}`}
                style={{ paddingLeft: `${0.5 + node.depth * 0.75}rem` }}
              >
                {node.name} <span className="text-ink-2">({node.assetCount})</span>
              </button>
            ))}
          </nav>

          <div className="max-h-[55vh] min-w-0 flex-1 overflow-y-auto">
            {failed ? (
              <p role="alert" className="text-[13px] text-error">
                {t('chooser.loadFailed')}
              </p>
            ) : listing && items.length === 0 ? (
              <EmptyState title={t('chooser.emptyTitle')} text={t('chooser.empty')} />
            ) : (
              <AssetGrid items={items} selected={multiple ? picked : new Set(selected)} onOpen={(it) => choose(it.id)} />
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3">
          {multiple ? <span className="text-[13px] text-ink-2">{t('chooser.selectedCount', { count: picked.size })}</span> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('chooser.cancel')}
            </Button>
            {multiple ? (
              <Button
                type="button"
                onClick={() => {
                  onConfirm([...picked]);
                  onOpenChange(false);
                }}
              >
                {t('chooser.confirm')}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
