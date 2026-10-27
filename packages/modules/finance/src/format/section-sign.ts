/**
 * „§ 13b“ bricht nie um (Designer Runde 8, Vorweg 1): Nach „§“ bzw. „§§“ steht ein geschütztes Leerzeichen. Die
 * Sprachdatei schreibt es selbst (Wächter `patterns/section-sign.test.ts`), jedes PDF über die Show-Regel im Einstieg
 * des Renderers (`packages/documents/src/renderer.ts`). Diese Funktion gilt für Texte des Moduls, die die Oberfläche
 * direkt zeigt (Kennzahlen der Formulare, Hilfezeilen der Kategorien).
 */
export function keepSectionSign(text: string): string {
  return text.replace(/(§+) /g, '$1 ');
}
