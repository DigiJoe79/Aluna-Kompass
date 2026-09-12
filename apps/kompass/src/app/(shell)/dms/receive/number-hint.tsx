'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { previewNumberAction } from '../actions';

/**
 * Eigene Komponente, nicht ein Zustand im Formular: Die Nummer kommt vom
 * Server, und wenn ihre Antwort eintrifft, zeichnet React neu. Geschieht das
 * im selben Tastendruck, in dem jemand tippt, schreibt React den alten Wert
 * ins Feld zurück und verliert das Zeichen. Hier zeichnet nur dieser Absatz
 * neu, die Felder daneben bleiben unberührt.
 */
export function NumberHint({ typeKey }: { typeKey: string }) {
  const t = useTranslations('dms');
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void previewNumberAction(typeKey).then((next) => {
      if (current) setNumber(next);
    });
    return () => {
      current = false;
    };
  }, [typeKey]);

  if (!number) return null;

  return (
    <p className="flex items-start gap-2 rounded-md bg-info-bg px-3.5 py-3 text-[13px] text-ink-2">
      <Info className="mt-px size-4 shrink-0 text-info" aria-hidden />
      <span>
        {t.rich('number.pending', {
          number,
          mono: (chunks) => <span className="font-mono">{chunks}</span>,
        })}
      </span>
    </p>
  );
}
