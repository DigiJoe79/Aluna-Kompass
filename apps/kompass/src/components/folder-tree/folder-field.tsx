'use client';

import { ChevronDown, ChevronRight, FolderMinus, Inbox, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { SectionHeading } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';
import { ancestorsOf, collapsedPath, nameOf, type FolderEntry } from '@/lib/folder-tree-model';
import { cn } from '@/lib/utils';
import { FolderTree } from './folder-tree';
import { useHiddenInputEvent } from '@/lib/use-hidden-input-event';

export interface FolderFieldProps {
  value: string | null;
  folders: FolderEntry[];
  label: string;
  /** „Eingangskorb“ bzw. „Ohne Ordner“ — steht da, wo kein Ordner gewählt ist, und als feste Zeile oben im Baum. */
  emptyLabel: string;
  /** Schreibt ein verstecktes Feld mit dem Pfad (`''` ohne Ordner) für `ActionForm`-Masken. */
  name?: string;
  /**
   * Die Wahl. Liefert sie ein Promise (sofort speichern, etwa im Dokument), wartet das Feld darauf und übernimmt erst
   * nach Erfolg; bei einem Fehler bleibt es offen und nennt den Grund. Ohne Promise gilt die Wahl sofort.
   */
  onChange?(path: string | null): void | Promise<ActionState>;
  /**
   * Legt einen Ordner an — nur mit dem Recht dazu (Akte `dms.manage`, Mediathek `media.upload`). Ohne: kein Knopf
   * „Neuer Ordner“.
   */
  onCreate?(parent: string | null, name: string): Promise<ActionState>;
  /** Nur `line`: Beschriftung des Knopfs, der den Baum aufklappt; Vorgabe „Verschieben nach…“. */
  moveLabel?: string;
  /** Ohne Recht zum Ändern: nur der Ort, kein Aufklappen. */
  readOnly?: boolean;
  /**
   * `field`: Feldkopf in Feldhöhe neben den übrigen Eingaben einer Maske, klappt im Feld auf.
   * `line` (Vorgabe): der Ort als Zeile mit Links, wie im Dokument, und ein Knopf, der darunter aufklappt.
   */
  variant?: 'line' | 'field';
  /** Nur `field`: Der Wert stammt aus einem Vorschlag — Rahmen wie die anderen vorbelegten Felder. */
  suggested?: boolean;
  /** Medien statt Dokumente: feste Zeile „Ohne Ordner“ mit `FolderMinus`, Zahlen als Dateien. */
  kind?: 'documents' | 'assets';
  /** `dt`: Das Feld steht in einer `<dl>` — die Beschriftung wird ein `<dt>`, der Ort ein `<dd>`. */
  labelAs?: 'span' | 'dt';
  /** Jeder Teil des Wegs ist ein Link in die Akte (HANDOFF § 3.5, Artboard 5). */
  linkToAkte?: boolean;
  /** Id der Fehlermeldung unter dem Feld; nur gesetzt, solange sie steht. */
  errorId?: string;
  /** `inbox`: Die feste Zeile ist der Eingangskorb (Symbol `Inbox`); sonst „Ohne Ordner“ (`FolderMinus`). */
  rootKind?: 'inbox' | 'none';
}

/** Am Telefon (unter `sm`) öffnet die Auswahl eine zweite Ebene im selben Blatt (Entwurf E5). */
const NARROW = '(max-width: 639px)';
function subscribeNarrow(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(NARROW);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const useNarrow = () =>
  useSyncExternalStore(subscribeNarrow, () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches, () => false);

/**
 * Ordnerfeld (HANDOFF § 3.5, Entwurf E5 Designer 2026-10-17; MUSTER § C): der Ort als Weg — Namen mit „›“, nie mit
 * Schrägstrichen. Gewählt wird **im Feld**: Es klappt auf (Suche, feste Zeile, Baum höchstens 288 px, „Neuer
 * Ordner in …“), Klick oder Enter wählt und klappt zu, Esc klappt zu ohne Änderung. Keine Auswahl in einem zweiten
 * Dialog; am Telefon eine zweite Ebene im selben Blatt mit „Übernehmen“. Folgt `value` von außen.
 */
export function FolderField({
  value,
  folders,
  label,
  emptyLabel,
  name,
  onChange,
  onCreate,
  moveLabel,
  readOnly = false,
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
  const head = useRef<HTMLButtonElement>(null);
  const hiddenRef = useHiddenInputEvent(current ?? '');
  /** Der geschlossene Wert passt nicht in eine Zeile: „… › Eltern › Ordner“ (Runde 3, Frage 2). */
  const [collapsed, setCollapsed] = useState(false);
  const valueBox = useRef<HTMLSpanElement>(null);
  const narrow = useNarrow();
  const feedback = useActionFeedback();
  const uid = useId();
  const labelId = `${uid}-label`;
  const panelId = `${uid}-panel`;
  // Ein neuer Wert von außen gilt; die eigene Wahl bis dahin auch (React: Zustand aus Props ableiten).
  if (value !== seen) {
    setSeen(value);
    setCurrent(value);
  }

  const field = variant === 'field';
  const parts = current === null ? [] : [...ancestorsOf(current), current];
  const Row = labelAs === 'dt' ? 'dd' : 'div';

  // Gekürzt wird nur, wenn der volle Weg nicht passt: erst voll zeigen, messen, dann kürzen; bei neuer Breite neu.
  useLayoutEffect(() => {
    setCollapsed(false);
  }, [current]);
  useLayoutEffect(() => {
    const box = valueBox.current;
    if (!box || collapsed || parts.length <= 2) return;
    if (box.scrollWidth > box.clientWidth) setCollapsed(true);
  }, [collapsed, parts.length, current]);
  useEffect(() => {
    const box = valueBox.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (box.clientWidth === width) return;
      width = box.clientWidth;
      setCollapsed(false);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const close = () => {
    setOpen(false);
    feedback.reset();
    head.current?.focus();
  };
  const pick = async (target: string | null): Promise<void> => {
    const state = await feedback.run(async () => (await onChange?.(target)) ?? { status: 'success' as const });
    if (state.status === 'error') return;
    setCurrent(target);
    close();
  };
  const create = async (parent: string | null, folderName: string): Promise<ActionState> => {
    if (!onCreate) return { status: 'idle' };
    const state = await feedback.run(() => onCreate(parent, folderName));
    if (state.status !== 'error') await pick(parent === null ? folderName : `${parent}/${folderName}`);
    return state;
  };

  // In einer Liste von Angaben (`dt`) gedämpft wie die übrigen Bezeichnungen, nicht fett (Runde 3, 031).
  const labelNode = labelAs === 'dt' ? <dt id={labelId} className="text-meta text-muted-ink">{label}</dt> : <span id={labelId} className="text-meta font-semibold text-ink-2">{label}</span>;

  const pathText = (links: boolean): ReactNode =>
    parts.length === 0
      ? emptyLabel
      : parts.map((path, i) => {
          const last = i === parts.length - 1;
          const text = links ? (
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
              {last ? <span className="font-semibold text-ink wrap-anywhere">{text}</span> : <span className={cn('wrap-anywhere', !links && 'text-muted-ink')}>{text}</span>}
            </Fragment>
          );
        });

  const shortPath = (shown: readonly (string | null)[]): ReactNode =>
    shown.map((path, i) => {
      const last = i === shown.length - 1;
      return (
        <Fragment key={path ?? '…'}>
          {i > 0 ? <span className="shrink-0 text-muted-ink-2">{' › '}</span> : null}
          {path === null ? (
            <span className="shrink-0 text-muted-ink">…</span>
          ) : last ? (
            <span className="min-w-0 truncate font-semibold text-ink">{nameOf(path)}</span>
          ) : (
            <span className="min-w-0 shrink truncate text-muted-ink">{nameOf(path)}</span>
          )}
        </Fragment>
      );
    });

  const picker = open ? (
    <Picker
      id={panelId}
      labelId={labelId}
      folders={folders}
      current={current}
      emptyLabel={emptyLabel}
      rootKind={rootKind}
      kind={kind}
      narrow={narrow}
      onPick={(target) => void pick(target)}
      onCreate={onCreate ? create : undefined}
      onClose={close}
      refusal={<RefusalNotice action state={feedback.state} />}
      anchor={head}
    />
  ) : null;

  if (readOnly) {
    return (
      <div className="flex flex-col gap-1.5">
        {labelNode}
        <Row data-folder-path className="flex flex-wrap items-center gap-x-1 text-body">
          {pathText(linkToAkte)}
        </Row>
        {name ? <input ref={hiddenRef} type="hidden" name={name} value={current ?? ''} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {labelNode}
      <Row className="flex flex-col gap-1.5">
        {field ? (
          <div
            className={cn(
              'flex flex-col rounded-md border bg-field',
              open && !narrow ? 'border-brand ring-2 ring-brand-soft' : suggested ? 'border-agent' : 'border-line-strong',
            )}
          >
            <button
              ref={head}
              type="button"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              aria-labelledby={`${labelId} ${uid}-value`}
              aria-describedby={errorId}
              aria-invalid={errorId ? true : undefined}
              title={current ?? emptyLabel}
              onClick={() => (open ? close() : setOpen(true))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && !open) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
              className="flex min-h-[var(--field-h)] w-full items-center gap-2 rounded-md px-2.5 text-left text-[length:var(--field-font)] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {/* Eine Zeile; der volle Weg steht im title und für Vorleser, gekürzt wird nur das Sichtbare. Die letzte Ebene
                  fällt nie weg, ist sie selbst zu lang, endet sie mit „…“ (Runde 3, Frage 2; 029, 036). */}
              <span id={`${uid}-value`} className="flex min-w-0 flex-1">
                {parts.length > 0 ? <span className="sr-only">{parts.map(nameOf).join(' › ')}</span> : null}
                <span ref={valueBox} aria-hidden={parts.length > 0 || undefined} data-folder-path className="flex min-w-0 flex-1 items-center gap-x-1 overflow-hidden whitespace-nowrap">
                  {parts.length === 0 ? emptyLabel : shortPath(collapsed ? collapsedPath(parts) : parts)}
                </span>
              </span>
              {narrow ? <ChevronRight className="size-4 shrink-0 text-muted-ink" aria-hidden /> : <ChevronDown className={cn('size-4 shrink-0 text-muted-ink transition-transform', open && 'rotate-180')} aria-hidden />}
            </button>
            {narrow ? null : picker}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span data-folder-path className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-body">
                {pathText(linkToAkte)}
              </span>
              <Button
                ref={head}
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => (open ? close() : setOpen(true))}
                aria-describedby={errorId}
                aria-invalid={errorId ? true : undefined}
              >
                {moveLabel ?? t('moveTo')}
              </Button>
            </div>
            {narrow || !open ? null : <div className="rounded-md border border-brand ring-2 ring-brand-soft">{picker}</div>}
          </>
        )}
        {narrow ? picker : null}
      </Row>
      {name ? <input type="hidden" name={name} value={current ?? ''} /> : null}
    </div>
  );
}

/** Die Ordner, die zur Suche passen, samt ihren Eltern (damit man den Ort sieht). */
function filterFolders(folders: FolderEntry[], query: string): { shown: FolderEntry[]; matches: Set<string> } {
  const q = query.trim().toLocaleLowerCase('de');
  if (!q) return { shown: folders, matches: new Set() };
  const matches = new Set(folders.filter((f) => nameOf(f.path).toLocaleLowerCase('de').includes(q)).map((f) => f.path));
  const keep = new Set([...matches].flatMap((p) => [p, ...ancestorsOf(p)]));
  return { shown: folders.filter((f) => keep.has(f.path)), matches };
}

function Picker({
  id,
  labelId,
  folders,
  current,
  emptyLabel,
  rootKind,
  kind,
  narrow,
  onPick,
  onCreate,
  onClose,
  refusal,
  anchor,
}: {
  id: string;
  labelId: string;
  folders: FolderEntry[];
  current: string | null;
  emptyLabel: string;
  rootKind?: 'inbox' | 'none';
  kind: 'documents' | 'assets';
  narrow: boolean;
  onPick(target: string | null): void;
  onCreate?(parent: string | null, name: string): Promise<ActionState>;
  onClose(): void;
  refusal: ReactNode;
  anchor: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations('folderTree');
  const tf = useTranslations('folderTree.field');
  const tm = useTranslations('moveDialog');
  const [query, setQuery] = useState('');
  /** Telefon: die Wahl gilt erst mit „Übernehmen“. */
  const [staged, setStaged] = useState<string | null>(current);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const { shown, matches } = useMemo(() => filterFolders(folders, query), [folders, query]);
  const rootMatches = !query.trim() || emptyLabel.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'));
  const selected = narrow ? staged : current;
  const RootIcon = kind === 'documents' && rootKind === 'inbox' ? Inbox : FolderMinus;
  const unitKey = kind === 'assets' ? 'files' : 'documents';
  const unit = { one: tm(`unit.${unitKey}.one`), many: tm(`unit.${unitKey}.many`) };
  const initialExpanded = useMemo(
    () => (query.trim() ? [...new Set([...matches].flatMap((p) => ancestorsOf(p)))] : current ? ancestorsOf(current) : []),
    [query, matches, current],
  );

  // Beim Öffnen hat die Suche den Fokus (Desktop) bzw. der Titel der zweiten Ebene (Telefon). Das aufgeklappte Feld rollt
  // ganz in den Blick — im Dialog schnitt der Fuß es sonst ab (Runde 3, 029, 036).
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (narrow) title.current?.focus();
    else {
      search.current?.focus({ preventScroll: true });
      group.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [narrow]);

  const choose = (path: string | null) => (narrow ? setStaged(path) : onPick(path));
  const parentForNew = selected;
  const startNew = () => {
    setNaming(true);
    setNewName('');
  };
  const commitNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !onCreate) return;
    const state = await onCreate(parentForNew, trimmed);
    if (state.status !== 'error') setNaming(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    // Esc klappt das Feld zu, nicht den Dialog darum (das zweite Esc schließt ihn).
    e.stopPropagation();
    e.preventDefault();
    if (naming) setNaming(false);
    else onClose();
  };

  const content = (
    <div className={cn('flex min-h-0 flex-col', narrow ? 'flex-1 gap-2' : 'gap-1.5 border-t border-line p-1.5')}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-ink" aria-hidden />
        <Input
          ref={search}
          type="search"
          aria-label={tf('search')}
          aria-controls={`${id}-tree`}
          placeholder={tf('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              box.current?.querySelector<HTMLElement>('[role="treeitem"], button[data-pick-fixed]')?.focus();
            }
          }}
          className="pl-8"
        />
      </div>
      {refusal}
      <div ref={box} id={`${id}-tree`} className={cn('overflow-y-auto', narrow ? 'min-h-0 flex-1' : 'max-h-72')}>
        {shown.length === 0 && !rootMatches ? (
          <p className="px-2 py-3 text-meta text-muted-ink">{tf('noMatch', { query: query.trim() })}</p>
        ) : (
          <FolderTree
            key={query.trim() ? `q:${query.trim()}` : 'all'}
            folders={shown}
            mode="pick"
            counts={false}
            selected={selected ?? null}
            fixed={rootMatches ? [{ key: 'root', label: emptyLabel, icon: RootIcon, dropTarget: false, folder: null, current: selected === null }] : []}
            unit={unit}
            storageKey={null}
            density={narrow ? 'touch' : 'default'}
            onPick={(path) => choose(path)}
            highlight={(path) => matches.has(path)}
            initialExpanded={initialExpanded}
          />
        )}
      </div>
      {onCreate ? (
        naming ? (
          <div className="flex items-center gap-2 px-1">
            <Input
              autoFocus
              aria-label={t('namePlaceholder')}
              placeholder={t('namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitNew();
                }
              }}
            />
          </div>
        ) : (
          <button type="button" onClick={startNew} className="w-fit rounded-sm px-2 py-1 text-left text-meta text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            {parentForNew === null ? tf('newTop') : tf('newIn', { name: nameOf(parentForNew) })}
          </button>
        )
      ) : null}
      {/* Tastenhilfe in der Textschrift wie in der Befehlspalette (Runde 3: 036). */}
      {narrow ? null : <p className="px-2 text-hint text-muted-ink">{tf('keys')}</p>}
    </div>
  );

  if (!narrow) {
    return (
      <div ref={group} id={id} role="group" aria-labelledby={labelId} onKeyDown={onKeyDown} className="scroll-mb-4">
        {content}
      </div>
    );
  }

  // Telefon: zweite Ebene im selben Blatt — über den Inhalt des Dialogs gelegt, kein zweites Blatt, keine neue
  // Überlagerung. Ohne Dialog (Seite) über das ganze Fenster.
  const host = anchor.current?.closest<HTMLElement>('[data-slot="dialog-content"], [data-slot="sheet-content"]') ?? null;
  const layer = (
    <div
      id={id}
      role="group"
      aria-labelledby={`${id}-title`}
      onKeyDown={onKeyDown}
      className={cn('z-50 flex flex-col gap-3 bg-surface p-4', host ? 'absolute inset-0' : 'fixed inset-0')}
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {tf('back')}
        </Button>
        <div className="min-w-0 flex-1" id={`${id}-title`}>
          <SectionHeading ref={title}>{t('pickTitle')}</SectionHeading>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={tf('close')} onClick={onClose} className="size-11">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {content}
      <div className="flex items-center gap-3 border-t border-line pt-3">
        <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{tf('chosen', { name: staged === null ? emptyLabel : nameOf(staged) })}</span>
        <Button type="button" onClick={() => onPick(staged)}>
          {tf('apply')}
        </Button>
      </div>
    </div>
  );
  return createPortal(layer, host ?? document.body);
}
