import path from 'node:path';

/**
 * Der Pfad einer Vorschaudatei aus den Segmenten der Adresse — oder `null`,
 * wenn er das Vorschauverzeichnis verliesse. Der Vergleich läuft mit dem
 * Trennzeichen am Ende: ohne es ginge ein Schwesterverzeichnis mit gleichem
 * Präfix (`site-preview-alt` neben `site-preview`) als innerhalb durch.
 */
export function resolvePreviewFile(root: string, parts: string[]): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}
