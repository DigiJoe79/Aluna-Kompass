'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { ancestorsOf, nameOf, type FolderEntry } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';
import { FolderMoveDialog } from './folder-move-dialog';

export interface FolderFieldProps {
  value: string | null;
  folders: FolderEntry[];
  label: string;
  /** „Eingangskorb“ bzw. „Kein Ordner“ — steht da, wo kein Ordner gewählt ist, und oben im Dialog. */
  emptyLabel: string;
  /** Schreibt ein verstecktes Feld mit dem Pfad (`''` ohne Ordner) für `ActionForm`-Masken. */
  name?: string;
  /**
   * Die Wahl im Dialog. Liefert sie ein Promise (sofort speichern, etwa im
   * Dokument), wartet der Dialog darauf und übernimmt erst nach Erfolg; bei
   * einem Fehler bleibt er offen und nennt den Grund. Ohne Promise (Maske mit
   * verstecktem Feld) gilt die Wahl sofort.
   */
  onChange?(path: string | null): void | Promise<ActionState>;
  /** Beschriftung des Knopfs und Titel des Dialogs; Vorgabe „Verschieben nach…“. */
  moveLabel?: string;
  /** Ein eigener Titel des Dialogs, wenn er anders heißen soll als der Knopf (Empfangsdialog: „Ändern…“ öffnet „Ordner wählen“). */
  dialogTitle?: string;
  /** Ohne Recht zum Verschieben: nur der Ort, kein Knopf. */
  readOnly?: boolean;
  /** Die Zeile „Liegt in …“ im Dialog; aus, wo noch nichts abgelegt ist. */
  showLocation?: boolean;
  /** `pick` in Masken für noch nicht Gespeichertes: „„X“ übernehmen“ statt „verschieben“ (siehe `FolderMoveDialog`). */
  verb?: 'move' | 'pick';
  /**
   * `line` (Vorgabe): der Ort als Zeile mit Links, wie im Dokument (Artboard 5).
   * `field`: als Feld mit Rahmen in Feldhöhe neben den übrigen Eingaben einer
   * Maske (Artboard 2f, Empfangsdialog).
   */
  variant?: 'line' | 'field';
  /** Nur `field`: Der Wert stammt aus einem Vorschlag — Rahmen wie die anderen vorbelegten Felder. */
  suggested?: boolean;
  /** Medien statt Dokumente: Symbol „Ohne Ordner“ und „Dateien“ im Dialog. */
  kind?: 'documents' | 'assets';
  /**
   * `dt`: Das Feld steht in einer `<dl>` — die Beschriftung wird ein `<dt>`,
   * der Ort samt Knopf ein `<dd>`, die Wurzel bleibt ein `<div>` (erlaubte
   * Gruppe). Ohne Optikänderung; Vorgabe `span`.
   */
  labelAs?: 'span' | 'dt';
  /** Jeder Teil des Wegs ist ein Link in die Akte (HANDOFF § 3.5, Artboard 5). */
  linkToAkte?: boolean;
  /** Id der Fehlermeldung unter dem Feld; nur gesetzt, solange sie steht — der Knopf verweist darauf und gilt als ungültig. */
  errorId?: string;
  /** `inbox`, wenn der leere Ort der Eingangskorb ist (Satz „Liegt im Eingangskorb.“ im Dialog). */
  rootKind?: 'inbox' | 'none';
}

/**
 * Ordnerfeld (HANDOFF § 3.5): der Ort als Weg — Namen mit „›“, nie mit
 * Schrägstrichen — und ein Knopf, der „Verschieben nach…“ öffnet. Ersetzt das
 * Auswahlfeld im Dokument, im Empfangsdialog und im Detaildialog eines Mediums.
 * Folgt `value` von außen; die Wahl im Dialog meldet `onChange`.
 */
export function FolderField({
  value,
  folders,
  label,
  emptyLabel,
  name,
  onChange,
  moveLabel,
  dialogTitle,
  readOnly = false,
  showLocation = true,
  verb = 'move',
  variant = 'line',
  suggested = false,
  kind = 'documents',
  linkToAkte = false,
  labelAs = 'span',
  errorId,
  rootKind,
}: FolderFieldProps) {
  const t = useTranslations('folderTree');
  const [current, setCurrent] = useState(value);
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  // Ein neuer Wert von außen gilt; die Wahl im Dialog bis dahin auch (React: Zustand aus Props ableiten).
  if (value !== seen) {
    setSeen(value);
    setCurrent(value);
  }

  const field = variant === 'field';
  const parts = current === null ? [] : [...ancestorsOf(current), current];
  const title = moveLabel ?? t('moveTo');

  const Row = labelAs === 'dt' ? 'dd' : 'div';

  const pick = async (target: string | null): Promise<ActionState> => {
    const pending = onChange?.(target);
    const result: ActionState = pending ? await pending : { status: 'success' };
    if (result.status !== 'error') setCurrent(target);
    return result;
  };

  return (
    <div className="flex flex-col gap-1.5">
      {labelAs === 'dt' ? <dt className="text-[13px] font-semibold text-ink-2">{label}</dt> : <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <Row className={cn('flex items-center', field ? 'gap-2' : 'gap-2.5')}>
        <span
          data-folder-path
          className={cn(
            'flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-sm',
            field && 'min-h-[var(--field-h)] rounded-md border bg-field px-2.5 py-1 text-[length:var(--field-font)] text-ink',
            field && (suggested ? 'border-info' : 'border-line-strong')
          )}
        >
          {parts.length === 0
            ? emptyLabel
            : parts.map((path, i) => {
                const last = i === parts.length - 1;
                const text = linkToAkte ? (
                  <Link href={`/dms?folder=${encodeURIComponent(path)}`} className="text-link hover:underline">
                    {nameOf(path)}
                  </Link>
                ) : (
                  nameOf(path)
                );
                return (
                  <Fragment key={path}>
                    {i > 0 ? (
                      <span aria-hidden className="text-muted-ink-2">
                        {' › '}
                      </span>
                    ) : null}
                    {last ? <strong className="font-semibold wrap-anywhere">{text}</strong> : <span className="wrap-anywhere">{text}</span>}
                  </Fragment>
                );
              })}
        </span>
        {readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size={field ? 'default' : 'sm'}
            onClick={() => setOpen(true)}
            aria-describedby={errorId}
            aria-invalid={errorId ? true : undefined}
          >
            {title}
          </Button>
        )}
      </Row>
      {name ? <input type="hidden" name={name} value={current ?? ''} /> : null}
      {readOnly ? null : (
        <FolderMoveDialog
          open={open}
          onOpenChange={setOpen}
          title={dialogTitle ?? title}
          showLocation={showLocation}
          verb={verb}
          subject={{ kind, ids: [], title: label, sources: { [current ?? '']: 1 } }}
          folders={folders}
          rootLabel={emptyLabel}
          rootKind={rootKind}
          onConfirm={pick}
        />
      )}
    </div>
  );
}
