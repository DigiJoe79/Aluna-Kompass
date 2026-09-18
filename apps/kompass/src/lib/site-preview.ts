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

/** Unter dieser Adresse liefert die Anwendung die gebaute Seite aus. */
const PREFIX = '/site/preview/';

/**
 * Biegt die Adressen einer gebauten Seite auf das Vorschauverzeichnis um.
 *
 * Gebaut wird für die Wurzel der späteren Domain, ausgeliefert wird unter
 * `/site/preview/`. Ein `<base>` allein genügt dafür nicht: Es wirkt nur auf
 * relative Adressen, und die gebaute Seite trägt absolute.
 *
 * Wer hier ein Attribut übersieht, merkt es nicht: Eine Adresse, die an der
 * Vorschau vorbeizeigt, landet in der Oberfläche von Kompass, und die
 * antwortet mit 200 und HTML. Im Browser bleibt das Bild leer, im Protokoll
 * steht nichts. Genau so blieb `srcset` bis zum 14.09. unbemerkt. Der Wächter
 * dazu steht in `e2e/site-publish.spec.ts` und prüft die Regel statt der
 * einzelnen Attribute.
 */
export function rewritePreviewHtml(html: string): string {
  return (
    html
      .replace(/href="\/(?!\/)/g, `href="${PREFIX}`)
      .replace(/src="\/(?!\/)/g, `src="${PREFIX}`)
      // `srcset` trägt mehrere Adressen in einem Attribut, jede mit ihrer Breite
      // dahinter; die Regel für `src` greift hier nicht. Wählt der Browser aus
      // dem `srcset`, fällt er bei einer falschen Adresse nicht auf `src`
      // zurück — das Bild bleibt leer.
      .replace(/srcset="([^"]+)"/g, (_, set: string) => `srcset="${set.replace(/(^|,\s*)\/(?!\/)/g, `$1${PREFIX}`)}"`)
      // Zuletzt, nicht zuerst: Stünde das `<base>` schon vorher da, bögen die
      // Regeln darüber seine eigene Adresse ein zweites Mal um, und relative
      // Adressen landeten unter `/site/preview/site/preview/`.
      .replace('<head>', `<head><base href="${PREFIX}">`)
  );
}
