'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ActionState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { DENSITY, rowClass, type FolderTreeDensity } from './folder-tree-row';

interface NameInputRowProps {
  /** 0 = oberste Ebene. */
  level: number;
  density: FolderTreeDensity;
  /** Bisheriger Name beim Umbenennen; leer bei einem neuen Ordner. */
  initial?: string;
  /** Pfeil wie in der Zeile, die umbenannt wird (Artboard 4c). */
  chevron?: 'open' | 'closed' | null;
  /** Fehlertext zum (schon getrimmten) Namen, `null`, wenn er geht; ein leerer Name ist kein Fehler. */
  check: (name: string) => string | null;
  /**
   * Speichert; bei Erfolg schließt der Baum die Zeile. `isOpen` sagt, ob diese
   * Zeile beim Fehler noch da ist und ihn nennen kann (beim optimistischen
   * Umbenennen verschwindet sie, solange der Server arbeitet).
   */
  onCommit: (name: string, isOpen: () => boolean) => Promise<ActionState>;
  /** Verwerfen: `refocus` nach Esc (Fokus zurück auf die Zeile), nicht nach einem Klick daneben. */
  onCancel: (refocus: boolean) => void;
}

/**
 * Eingabezeile für „Neuer Ordner“, „Neuer Unterordner“ und „Umbenennen“
 * (README § 3, Artboard 4b–4d). Enter speichert, Esc oder ein Klick daneben
 * verwirft, leer gelassen passiert nichts. Fehler erscheinen schon beim
 * Tippen; der Server prüft endgültig, und lehnt er ab, bleibt das Feld offen.
 * Solange es offen ist, gelten die Tasten des Baums nicht: Headless Tree und
 * die Sprung-Suche lassen Eingabefelder aus.
 */
export function NameInputRow({ level, density, initial = '', chevron = null, check, onCommit, onCancel }: NameInputRowProps) {
  const t = useTranslations('folderTree');
  const { indent, base, chevron: chevronWidth } = DENSITY[density];
  const [value, setValue] = useState(initial);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  /** Zu: gespeichert oder verworfen — ein `blur` danach verwirft nicht noch einmal. */
  const closed = useRef(false);
  const errorId = useId();

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const name = value.trim();
  const error = serverError ?? (name === '' ? null : check(name));

  const cancel = (refocus: boolean) => {
    if (closed.current) return;
    closed.current = true;
    onCancel(refocus);
  };

  const submit = async () => {
    if (saving) return;
    if (name === '' || name === initial) {
      cancel(true);
      return;
    }
    if (error) return;
    setSaving(true);
    let result: ActionState;
    try {
      result = await onCommit(name, () => mounted.current && !closed.current);
    } catch {
      // Netz weg oder Server-Absturz: Das Feld bleibt offen und bedienbar.
      result = { status: 'error', message: t('error.unexpected'), fieldErrors: {} };
    } finally {
      setSaving(false);
    }
    if (result.status === 'error') {
      setServerError(Object.values(result.fieldErrors)[0] ?? result.detail ?? result.message);
      ref.current?.focus();
      return;
    }
    closed.current = true;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    // Weder der Baum noch ein umgebender Dialog sollen Enter oder Esc sehen.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') cancel(true);
    else void submit();
  };

  return (
    <div role="none" data-name-input className={cn(rowClass(density), 'text-ink')} style={{ paddingLeft: base + level * indent }}>
      {Array.from({ length: level }, (_, i) => (
        <span key={i} aria-hidden className="pointer-events-none absolute -top-[3px] -bottom-[3px] w-px bg-tree-guide" style={{ left: base + i * indent + chevronWidth / 2 - 1 }} />
      ))}
      <span aria-hidden className={cn('grid shrink-0 place-items-center text-muted-ink', density === 'touch' ? 'h-9' : 'h-7')} style={{ width: chevronWidth }}>
        {chevron ? <ChevronRight className={cn('size-3.5', chevron === 'open' && 'rotate-90')} strokeWidth={2.4} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setServerError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!saving) cancel(false);
          }}
          readOnly={saving}
          aria-busy={saving || undefined}
          aria-label={t('namePlaceholder')}
          placeholder={t('namePlaceholder')}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'w-full min-w-0 rounded-sm border bg-field px-2 font-normal text-ink outline-2 outline-offset-1 outline-focus placeholder:text-placeholder',
            density === 'touch' ? 'h-9' : 'h-7',
            error ? 'border-error' : 'border-line-strong'
          )}
        />
        {error ? (
          <span id={errorId} className="text-[12px] leading-4 font-semibold text-pretty text-error">
            {error}
          </span>
        ) : null}
      </span>
    </div>
  );
}
