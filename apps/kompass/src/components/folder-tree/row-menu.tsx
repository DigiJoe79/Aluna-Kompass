'use client';

import { CornerDownRight, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';

/** Für welche Zeile das Menü offen ist und woran es hängt (der „…“-Knopf der Zeile). */
export type RowMenuTarget = { path: string; anchor: Element };

interface RowMenuProps {
  target: RowMenuTarget | null;
  onClose: () => void;
  /** Wohin der Fokus nach dem Schließen geht; `false`, wenn eine Eingabezeile ihn schon hat. */
  finalFocus: () => HTMLElement | false;
  /** Ein Eintrag fehlt, wenn sein Handler fehlt; ein String ist der Sperrgrund. */
  onNewSubfolder?: () => void;
  newSubfolderBlocked?: string | null;
  onRename?: () => void;
  onMove?: () => void;
  extra?: ReactNode;
  onDelete?: () => void;
  deleteBlocked?: string | null;
}

/**
 * Das Menü an einem Ordner (Board K7, Artboard 4a): „…“, Rechtsklick,
 * Umschalt+F10 und die Menütaste öffnen dasselbe. Reihenfolge: Neuer
 * Unterordner · Umbenennen · Verschieben nach… · (Erweiterungen) ·
 * Trennlinie · Löschen. Ein gesperrtes „Löschen“ bleibt sichtbar und nennt
 * den Grund.
 */
export function RowMenu({ target, onClose, finalFocus, onNewSubfolder, newSubfolderBlocked, onRename, onMove, extra, onDelete, deleteBlocked }: RowMenuProps) {
  const t = useTranslations('folderTree');
  return (
    <DropdownMenu
      open={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent anchor={target?.anchor} align="start" side="bottom" finalFocus={finalFocus} className="w-68 max-w-[calc(100vw-2rem)]">
        {onNewSubfolder ? (
          <DropdownMenuItem onSelect={onNewSubfolder} disabledReason={newSubfolderBlocked ?? undefined}>
            <FolderPlus className="text-muted-ink" aria-hidden />
            {t('newSubfolder')}
          </DropdownMenuItem>
        ) : null}
        {onRename ? (
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="text-muted-ink" aria-hidden />
            {t('rename')}
            <DropdownMenuShortcut aria-hidden className="font-mono tracking-normal">
              {t('keyNames.f2')}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {onMove ? (
          <DropdownMenuItem onSelect={onMove}>
            <CornerDownRight className="text-muted-ink" aria-hidden />
            {t('moveTo')}
          </DropdownMenuItem>
        ) : null}
        {extra}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} disabledReason={deleteBlocked ?? undefined}>
              <Trash2 className={deleteBlocked ? undefined : 'text-muted-ink'} aria-hidden />
              {t('delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
