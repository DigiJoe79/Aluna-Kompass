/**
 * Eine Grundlage mit Datum (Befunde J und AK): die Anspruchsgrundlage des
 * Aufwandsverzichts („vereinbart am“) und die Grundlage der
 * Vorstandsvergütung („gilt ab“). Sie trägt einen Vorgang nur, wenn sie an
 * dessen Tag schon galt — nicht, weil sie heute eingetragen ist. Ohne Datum
 * (Bestand von vor der Pflicht) trägt sie nichts. Rein, ISO-Daten.
 */
export function basisInForceOn(since: string | null | undefined, date: string): boolean {
  return !!since && since <= date;
}
