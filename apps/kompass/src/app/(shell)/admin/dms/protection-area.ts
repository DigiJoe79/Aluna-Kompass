/**
 * Der Schutzbereich aus einem Formular der Dokumentarten. Nur wenn das Feld im
 * Formular vorkommt: Ein Formular ohne Auswahl (nicht bedienbar, Art eines
 * Moduls) fasst den Bereich nie an. Ein leerer Wert nimmt den Schutz weg.
 */
export function readProtectionArea(formData: FormData): string | null | undefined {
  if (!formData.has('protectionArea')) return undefined;
  const value = String(formData.get('protectionArea') ?? '').trim();
  return value === '' ? null : value;
}
