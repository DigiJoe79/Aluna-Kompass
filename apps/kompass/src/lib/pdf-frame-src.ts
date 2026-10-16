/**
 * Adresse eines PDFs im eingebetteten Browser-Betrachter, ohne dessen Werkzeugleiste (Designer Stufe 2 Nr. 8): Die
 * Leiste stellt Drucken, Herunterladen und Zoom ein zweites Mal neben unsere Knöpfe. `toolbar=0` versteht nur
 * Chromium; andere Betrachter überlesen es. Ein Treffer der Volltextsuche springt weiter über `page`.
 */
export function pdfFrameSrc(url: string, { page }: { page?: number } = {}): string {
  const base = url.split('#')[0]!;
  return `${base}#${page ? `page=${page}&` : ''}toolbar=0`;
}
