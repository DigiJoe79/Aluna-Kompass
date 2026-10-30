import path from 'node:path';
import { APP_CONTENT_SECURITY_POLICY } from './app-csp';

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
export function rewritePreviewHtml(html: string, prefix: string = PREFIX): string {
  return (
    html
      .replace(/href="\/(?!\/)/g, `href="${prefix}`)
      .replace(/src="\/(?!\/)/g, `src="${prefix}`)
      // `srcset` trägt mehrere Adressen in einem Attribut, jede mit ihrer Breite
      // dahinter; die Regel für `src` greift hier nicht. Wählt der Browser aus
      // dem `srcset`, fällt er bei einer falschen Adresse nicht auf `src`
      // zurück — das Bild bleibt leer.
      .replace(/srcset="([^"]+)"/g, (_, set: string) => `srcset="${set.replace(/(^|,\s*)\/(?!\/)/g, `$1${prefix}`)}"`)
      // Zuletzt, nicht zuerst: Stünde das `<base>` schon vorher da, bögen die
      // Regeln darüber seine eigene Adresse ein zweites Mal um, und relative
      // Adressen landeten unter `/site/preview/site/preview/`.
      .replace('<head>', `<head><base href="${prefix}">`)
  );
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

/**
 * Kopfzeilen einer Vorschau-Antwort. HTML ist die Webseite selbst: Sie bekommt
 * den CSP der Anwendung (ihre Skripte laufen, gerahmt nur von Kompass). Alles
 * andere — Bilder, SVG, PDF, Stile — bekommt `sandbox` wie `app/media/[id]`:
 * Ein SVG aus der Mediathek, direkt aufgerufen, liefe sonst im Ursprung der
 * Anwendung. Stile und Skripte, die eine Seite einbindet, bleiben davon
 * unberührt; die Sandbox wirkt nur, wenn die Datei selbst das Dokument ist.
 */
export function previewResponseHeaders(ext: string): Record<string, string> {
  return {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': ext === '.html' ? APP_CONTENT_SECURITY_POLICY : 'sandbox',
  };
}
