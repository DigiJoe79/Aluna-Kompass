'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
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
  const [preview, setPreview] = useState<{ number: string | null } | null>(null);

  useEffect(() => {
    let current = true;
    void previewNumberAction(typeKey).then((next) => {
      if (current) setPreview(next);
    });
    return () => {
      current = false;
    };
  }, [typeKey]);

  if (!preview) return null;

  return (
    <Notice level="warn">
      {preview.number
        ? t.rich('number.pending', {
            number: preview.number,
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })
        : t('number.numberOnFiling')}
    </Notice>
  );
}
