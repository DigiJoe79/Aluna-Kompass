'use client';

import { CircleSlash, Files, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { uploadMediaAction } from '@/app/(shell)/admin/media/actions';
import { EmptyState } from '@/components/empty-state';
import { FolderSheet } from '@/components/folder-tree/folder-sheet';
import { FolderTree } from '@/components/folder-tree/folder-tree';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { runAction, toastNetwork } from '@/lib/feedback';
import { ancestorsOf, isWithin, nameOf, namesBelow, type FolderEntry } from '@/lib/folder-tree-model';
import type { MediaListing } from '@/lib/media-listing';
import { usePreference } from '@/lib/preferences';
import { AssetGrid } from './asset-grid';

export interface MediaChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Was das Feld nimmt — der Dialog zeigt nur das. */
  kind: 'image' | 'pdf';
  multiple: boolean;
  /**
   * Nur bei `multiple`: wie viele höchstens gewählt sein dürfen, die bereits gewählten mitgezählt. An der
   * Grenze sind die übrigen Kacheln gesperrt und der Fuß sagt, warum (Befund 6, 0.2.4: das 13. Tierfoto).
   */
  max?: number;
  /** Bereits gewählte IDs; bei multiple vorab angehakt, bei single nur markiert. */
  selected: string[];
  onConfirm: (ids: string[]) => void;
}

const ACCEPT = { image: 'image/png,image/jpeg,image/webp,image/svg+xml', pdf: 'application/pdf' } as const;
type Sort = 'newest' | 'oldest' | 'name' | 'size';
const SORTS: Sort[] = ['newest', 'oldest', 'name', 'size'];

/** Gemerkt als `mediaChooserFolder`: `null` = „Alle Dateien“, `''` = „Ohne Ordner“ (kein gültiger Pfad), sonst der Ordner. */
const UNFILED = '';

/**
 * Nur Ordner mit passenden Dateien und deren Vorfahren (Handoff § 9.2): Ein
 * Ordner ohne Bild hat im Bild-Dialog nichts zu bieten. Die Zahlen zählen
 * schon nur die Art des Dialogs.
 */
function foldersWithMatches(folders: MediaListing['folders']): FolderEntry[] {
  const keep = new Set<string>();
  for (const f of folders) if (f.assetCount > 0) for (const path of [...ancestorsOf(f.path), f.path]) keep.add(path);
  return folders.filter((f) => keep.has(f.path)).map((f) => ({ path: f.path, count: f.assetCount }));
}

/**
 * Die Mediathek in klein (README § 3, Artboard 8): der Ordnerbaum als Filter
 * links, Kacheln rechts, Suche und Upload oben. Klick im Baum wählt — kein
 * Link, kein „…“, kein Ziehen. Einzelauswahl: Klick auf die Kachel übernimmt
 * sofort. Mehrfachauswahl: Häkchen und „Übernehmen“. Ein Upload landet im
 * offenen Ordner und wird ausgewählt.
 */
export function MediaChooserDialog({ open, onOpenChange, kind, multiple, max, selected, onConfirm }: MediaChooserDialogProps) {
  const t = useTranslations('media');
  const tMove = useTranslations('moveDialog');
  const [folder, setFolder] = usePreference('mediaChooserFolder');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [listing, setListing] = useState<MediaListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const [uploading, setUploading] = useState(false);
  const [uploadRefusal, setUploadRefusal] = useState<ActionState>({ status: 'idle' });
  const tCommon = useTranslations('common');
  const fileInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();

  // `selected` kommt vom aufrufenden Formular und bekommt bei jedem Render dort
  // (z. B. nach einem Server-Action-Refresh der Seite während des Uploads) eine
  // neue Array-Referenz, auch wenn sich der Inhalt nicht ändert. Ein Ref hält den
  // aktuellen Wert, ohne dass er den Effekt unten erneut auslöst — sonst würde
  // jeder solche Refresh die gerade angehakte Auswahl mitten im Dialog verwerfen.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Beim Öffnen den Stand des Feldes übernehmen — nur beim Öffnen, nicht bei
  // jeder Änderung der (instabilen) `selected`-Referenz während der Dialog offen ist.
  useEffect(() => {
    if (open) setPicked(new Set(selectedRef.current));
  }, [open]);

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

  const shownFolders = useMemo(() => foldersWithMatches(listing?.folders ?? []), [listing]);
  /** Ein geöffneter Ordner, oder `null` bei „Alle Dateien“ und „Ohne Ordner“. */
  const openFolder = folder === null || folder === UNFILED ? null : folder;
  const items = useMemo(
    () =>
      (listing?.items ?? []).map((it) => ({
        id: it.id,
        filename: it.filename,
        mimeType: it.mimeType,
        used: it.references.length > 0,
        // Der Ort unter dem geöffneten Ordner, wie in der Mediathek (Spec § 9).
        place: openFolder === null || it.folder === null ? '' : namesBelow(it.folder, openFolder).join(' › '),
      })),
    [listing, openFolder]
  );

  // Ein gemerkter Ordner, den es nicht mehr gibt (umbenannt, gelöscht) oder der
  // nichts Passendes enthält, steht nicht im Baum: zurück auf „Alle Dateien“.
  useEffect(() => {
    if (listing && openFolder !== null && !shownFolders.some((f) => f.path === openFolder)) setFolder(null);
  }, [listing, openFolder, shownFolders, setFolder]);

  const choose = (id: string) => {
    if (!multiple) {
      onConfirm([id]);
      onOpenChange(false);
      return;
    }
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else if (max === undefined || next.size < max) next.add(id);
      return next;
    });
  };

  const upload = async (files: FileList) => {
    setUploading(true);
    setUploadRefusal({ status: 'idle' });
    try {
      let last: string | null = null;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set('file', file);
        if (folder) fd.set('folder', folder);
        const state = await runAction(() => uploadMediaAction(fd), tCommon('network'));
        if (state.status === 'error') {
          if (state.kind === 'network') toastNetwork(state, tCommon('retry'), () => fileInput.current?.click());
          else setUploadRefusal(state);
          continue;
        }
        if (state.status === 'success') {
          const data = state.data as { id: string; created: boolean };
          if (!data.created && state.message) toast.info(state.message);
          last = data.id;
          // Hochladen geht auch an der Grenze; angehakt wird nur, was noch Platz hat.
          if (multiple) setPicked((p) => (max !== undefined && p.size >= max && !p.has(data.id) ? p : new Set(p).add(data.id)));
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

  const full = multiple && max !== undefined && picked.size >= max;
  const blocked = useMemo(
    () => (full ? { ids: new Set(items.filter((it) => !picked.has(it.id)).map((it) => it.id)), reasonId } : undefined),
    [full, items, picked, reasonId]
  );

  // Der Ortsknopf am Telefon nennt, was die Spalte am Schreibtisch zeigt: Ort und Summe (wie in der Mediathek).
  const place =
    folder === UNFILED
      ? { path: [], title: t('noFolder'), count: listing?.unfiledCount ?? 0 }
      : openFolder === null
        ? { path: [], title: t('root'), count: listing?.total ?? 0 }
        : {
            path: ancestorsOf(openFolder).map(nameOf),
            title: nameOf(openFolder),
            count: shownFolders.filter((f) => isWithin(f.path, openFolder)).reduce((sum, f) => sum + f.count, 0),
          };

  const title = multiple ? t('chooser.titleMultiple') : kind === 'pdf' ? t('chooser.titlePdf') : t('chooser.titleImage');

  const tree = (density: 'default' | 'touch') => (
    <FolderTree
      folders={shownFolders}
      mode="pick"
      selected={openFolder}
      fixed={[
        { key: 'all', label: t('root'), icon: kind === 'image' ? ImageIcon : Files, count: listing?.total, dropTarget: false, folder: null, current: folder === null },
        { key: 'unfiled', label: t('noFolder'), icon: CircleSlash, count: listing?.unfiledCount, dropTarget: false, folder: null, current: folder === UNFILED },
      ]}
      onPick={(path, fixedKey) => setFolder(path ?? (fixedKey === 'unfiled' ? UNFILED : null))}
      unit={{ one: tMove('unit.files.one'), many: tMove('unit.files.many') }}
      storageKey={null}
      // Der Baum filtert hier: Das Gewählte zeigt seine Zahl, kein Häkchen (Artboard 8).
      pickCheck={false}
      density={density}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
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

        <RefusalNotice action state={uploadRefusal} />

        {/* Telefon (`max-sm`): kein Baum neben den Kacheln, sondern der Ortsknopf darüber — wie in Mediathek und Akte. */}
        <FolderSheet {...place} place={JSON.stringify(folder)} className="mb-0 sm:hidden">
          {tree('touch')}
        </FolderSheet>

        <div className="flex gap-4">
          <div className="max-h-[55vh] w-60 shrink-0 overflow-y-auto border-r border-line pr-3 max-sm:hidden">{tree('default')}</div>

          <div className="max-h-[55vh] min-w-0 flex-1 overflow-y-auto">
            {failed ? (
              <p role="alert" className="text-[13px] text-error">
                {t('chooser.loadFailed')}
              </p>
            ) : listing && items.length === 0 ? (
              <EmptyState title={t('chooser.emptyTitle')} text={t('chooser.empty')} />
            ) : (
              <AssetGrid items={items} selected={multiple ? picked : new Set(selected)} onOpen={(it) => choose(it.id)} blocked={blocked} />
            )}
          </div>
        </div>

        {multiple ? (
          <FormActionBar
            placement="dialog"
            cancel={() => onOpenChange(false)}
            saveLabel={t('chooser.confirm')}
            note={
              <span className="flex flex-col" aria-live="polite">
                <span>{max === undefined ? t('chooser.selectedCount', { count: picked.size }) : t('chooser.selectedOfMax', { count: picked.size, max })}</span>
                {full ? <span id={reasonId}>{t('chooser.limitReached', { max })}</span> : null}
              </span>
            }
            onSave={() => {
              onConfirm([...picked]);
              onOpenChange(false);
            }}
          />
        ) : (
          // Einzelwahl: Ein Klick auf die Datei wählt, es gibt nur „Abbrechen“.
          <DialogFooter className="flex items-center justify-between gap-3">
            <span />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('chooser.cancel')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
