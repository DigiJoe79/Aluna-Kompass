/**
 * Das Fähnchen unter einem vorbelegten Feld. Ohne es sieht ein Vorschlag der
 * Einsortierregeln aus wie Tipparbeit des Nutzers — und wer nicht weiss, woher
 * ein Wert kommt, prüft ihn entweder gar nicht oder jedes Mal neu.
 *
 * Grau und ohne Pfeil: Es ist eine Herkunft, keine Aktion — Info-Blau sah aus wie ein Link (03 B19). Den Vorschlag
 * selbst zeigt der Rahmen `border-agent` am Feld (03 B20, MUSTER § E).
 */
export function SuggestionFlag({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="text-hint text-muted-ink">{text}</p>
  );
}
