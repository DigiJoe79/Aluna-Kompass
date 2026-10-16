'use client';

import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Suchfeld einer Liste (Board § L Ziel 1, HANDOFF § 8e.1): Lupe links, ✕ „Suche leeren“, sobald Text drin
 * steht, 260 px breit (Telefon volle Breite), zugänglicher Name „Suchen“; der Platzhalter nennt die Felder.
 *
 * `value` ist der Wert der Adresse (an der Seite über `useUrlFilters`). Das Feld hält den getippten Text selbst
 * und meldet ihn erst nach `delayMs` — die Adresse läuft dem Tippen nach. Es folgt `value`, wenn der von außen
 * wechselt (Zurück-Knopf, Chip, „Filter zurücksetzen“), aber nicht, wenn nur der zuletzt gesendete Wert
 * zurückkommt: Sonst fräße die nachlaufende Adresse die jüngsten Buchstaben. ✕ leert sofort und lässt den Fokus
 * im Feld.
 */
const PHONE = '(max-width: 639px)';

function subscribePhone(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(PHONE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Unter 640 px (`max-sm`); auf dem Server und ohne `matchMedia` gilt der Rechner. */
function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches, () => false);
}

export function SearchField({
  value,
  onChange,
  placeholder,
  placeholderShort,
  delayMs = 250,
  testId,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /**
   * Kurzform für das Telefon (unter 640 px), aus der Sprachdatei: Dort wird gekürzt statt abgeschnitten
   * („Name, E-Mail …“, Designer 2026-10-16, Teil 2 Nr. 12). Ohne sie gilt `placeholder` überall.
   */
  placeholderShort?: string;
  delayMs?: number;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations('common');
  const phone = usePhone();
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Der Zeitgeber meldet an das jüngste `onChange`: Die Seite baut die Adresse aus allen Filtern, und wer während
  // der Verzögerung einen anderen Filter setzt, verlöre ihn sonst an den Stand vom Tippen.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const send = (next: string) => {
    sent.current = next;
    latest.current(next);
  };

  const type = (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      send(next);
    }, delayMs);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setText('');
    send('');
    input.current?.focus();
  };

  return (
    <div className={cn('relative w-[var(--search-w,260px)] max-sm:w-full', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-ink" aria-hidden />
      <Input
        ref={input}
        type="search"
        aria-label={t('search')}
        placeholder={phone && placeholderShort ? placeholderShort : placeholder}
        value={text}
        onChange={(e) => type(e.target.value)}
        data-testid={testId}
        className="pr-9 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('clearSearch')}
          onClick={clear}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-ink"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
