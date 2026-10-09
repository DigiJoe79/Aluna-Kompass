import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Wortschatz der ganzen Oberfläche: Wörter, für die die Oberfläche ein eigenes Wort hat. Die Finanzen haben dazu
 * ihre eigene Liste (`finance-wording.test.ts`); diese gilt für jeden Text in `de.json`, auch das Protokoll.
 */
const FORBIDDEN: { pattern: RegExp; word: string; instead: string }[] = [
  // Designer 2026-10-09: In der Oberfläche heißt es „Vorlage“ („Vorlage der Webseite“, wo „Dokumentvorlage“ daneben steht).
  // Großgeschrieben, damit der Dateiname `kompass.template.ts` in einer Meldung nicht trifft.
  { pattern: /\bTemplate/, word: 'Template', instead: 'Vorlage' },
];

/** Schlüssel → Grund. Nur, wo das Wort Teil eines Eigennamens oder Produktnamens ist. */
const ALLOWED: Record<string, string> = {};

function strings(node: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
  if (typeof node === 'string') out.set(prefix, node);
  else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) strings(value, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

function hits(texts: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [key, value] of texts) {
    if (key in ALLOWED) continue;
    for (const { pattern, word, instead } of FORBIDDEN) if (pattern.test(value)) out.push(`${key}: „${word}“ statt „${instead}“ in "${value}"`);
  }
  return out;
}

describe('Wortschatz der Oberfläche', () => {
  it('kein gesperrtes Wort in de.json', () => {
    expect(hits(strings(messages, '', new Map()))).toEqual([]);
  });

  it('findet das Wort, aber nicht den Dateinamen', () => {
    expect(hits(new Map([['x', 'Das Template fehlt.']]))).toHaveLength(1);
    expect(hits(new Map([['x', 'Es fehlt die Datei kompass.template.ts.']]))).toEqual([]);
  });

  it('kein „Template“ in den Handbuchteilen für Nutzer (Designer 2026-10-09)', () => {
    const offenders: string[] = [];
    for (const file of markdown(HANDBOOK)) {
      const rel = path.relative(HANDBOOK, file);
      if (rel in HANDBOOK_ALLOWED) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/\bTemplate/.test(line.replaceAll('Vorlage (Template-Datei)', ''))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

const HANDBOOK = path.resolve(import.meta.dirname, '../../../docs/handbuch');

/** Datei → Grund: Teile für Betreiber und für Autoren von Vorlagen, dort ist „Template“ der Dateityp. */
const HANDBOOK_ALLOWED: Record<string, string> = {
  'betrieb.md': 'Betrieb: erklärt das Verzeichnis und die Datei des Templates für die Person, die die Installation betreut.',
  [path.join('webseite', 'template-schreiben.md')]: 'Für Autoren von Vorlagen: erklärt die Template-Datei und ihre Deklaration.',
};

function markdown(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? markdown(full) : name.endsWith('.md') ? [full] : [];
  });
}
