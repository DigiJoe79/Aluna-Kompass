import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Ein Schlüssel, den es nicht gibt, fällt in der Entwicklung nicht auf:
 * next-intl meldet ihn nur im Protokoll und zeichnet den Pfad als Text. Auf dem
 * Bildschirm steht dann „content.backToList“ statt „Zurück zur Übersicht“ — und
 * kein Test merkt es, solange keiner genau diese Beschriftung liest.
 *
 * Genau so ging am 11.09. ein falsch gebundener Namensraum durch drei grüne
 * Prüfringe bis in die CI: `c` war in einer Datei `common`, in der nächsten
 * `content`, und die Ersetzung nahm an, es sei überall dasselbe.
 *
 * Geprüft wird der einfache, häufige Fall: Ein Übersetzer wird einem Namen
 * zugewiesen, und dieser Name wird mit einem festen Schlüssel aufgerufen.
 * Aufrufe mit zusammengesetztem Schlüssel (`t(\`tabs.${key}\`)`) kann der Test
 * nicht prüfen und lässt sie aus.
 */
const ROOT = path.resolve(import.meta.dirname, '../src');

/** `const t = useTranslations('ns')` bzw. `await getTranslations('ns')`. */
const BINDING = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*'([^']*)'\s*\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function resolves(dotted: string): boolean {
  let node: unknown = messages;
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
    if (node === undefined) return false;
  }
  return typeof node === 'string';
}

function missingIn(source: string): string[] {
  const namespaces = new Map<string, string>();
  for (const [, name, ns] of source.matchAll(BINDING)) {
    if (name && ns !== undefined) namespaces.set(name, ns);
  }

  const missing: string[] = [];
  for (const [name, ns] of namespaces) {
    const call = new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g');
    for (const [, key] of source.matchAll(call)) {
      if (!key) continue;
      const dotted = ns ? `${ns}.${key}` : key;
      if (!resolves(dotted)) missing.push(dotted);
    }
  }
  return missing;
}

describe('Übersetzungsschlüssel', () => {
  it('gibt es alle in der Sprachdatei', () => {
    const missing = walk(ROOT)
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) =>
        missingIn(readFileSync(file, 'utf8')).map((key) => `${path.relative(ROOT, file)}: ${key}`),
      );

    expect([...new Set(missing)]).toEqual([]);
  });
});
