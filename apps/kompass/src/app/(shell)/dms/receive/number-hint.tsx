'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '@/components/notice';
import { previewNumberAction } from '../actions';

/**
 * Eigene Komponente, nicht ein Zustand im Formular: Die Nummer kommt vom
 * Server, und wenn ihre Antwort eintrifft, zeichnet React neu. Geschieht das
 * im selben Tastendruck, in dem jemand tippt, schreibt React den alten Wert
 * ins Feld zurück und verliert das Zeichen. Hier zeichnet nur dieser Absatz
 * neu, die Felder daneben bleiben unberührt.
 */
export function NumberHint({ typeKey, on = 'receive' }: { typeKey: string; on?: 'receive' | 'file' }) {
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
  const mono = (chunks: ReactNode) => <span className="font-mono">{chunks}</span>;
  // Festschreiben eines Entwurfs (Runde 3, 035): Die Nummer nennen, sonst sagt der Dialog es schon allgemein.
  if (on === 'file') {
    return preview.number ? (
      <Notice level="hint">{t.rich('number.onFile', { number: preview.number, mono })}</Notice>
    ) : null;
  }

  return (
    // Ein Hinweis, keine Warnung: Nichts ist falsch, die Nummer wird nur angekündigt (03 B17, MUSTER § A).
    <Notice level="hint">
      {preview.number
        ? t.rich('number.pending', {
            number: preview.number,
            mono,
          })
        : t('number.numberOnFiling')}
    </Notice>
  );
}
