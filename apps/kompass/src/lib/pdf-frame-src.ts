/**
 * Adresse eines PDFs im eingebetteten Browser-Betrachter, ohne dessen Werkzeugleiste (Designer Stufe 2 Nr. 8): Die
 * Leiste stellt Drucken, Herunterladen und Zoom ein zweites Mal neben unsere Knöpfe. `toolbar=0` versteht nur
 * Chromium; andere Betrachter überlesen es. Ein Treffer der Volltextsuche springt weiter über `page`.
 */
export function pdfFrameSrc(url: string, { page, fit }: { page?: number; fit?: 'width' } = {}): string {
  const base = url.split('#')[0]!;
  // `view=FitH`: Seite auf die Breite des Rahmens — mit einem Rahmen im Seitenformat bleibt keine dunkle Fläche des
  // Betrachters um die Seite (Runde 3, 030–035).
  return `${base}#${page ? `page=${page}&` : ''}toolbar=0${fit === 'width' ? '&view=FitH' : ''}`;
}
