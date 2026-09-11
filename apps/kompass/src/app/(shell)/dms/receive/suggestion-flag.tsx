import { ArrowDownToLine } from 'lucide-react';

/**
 * Das Fähnchen unter einem vorbelegten Feld. Ohne es sieht ein Vorschlag der
 * Einsortierregeln aus wie Tipparbeit des Nutzers — und wer nicht weiss, woher
 * ein Wert kommt, prüft ihn entweder gar nicht oder jedes Mal neu.
 */
export function SuggestionFlag({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-info">
      <ArrowDownToLine className="size-3" aria-hidden />
      {text}
    </p>
  );
}
