import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { labelTranslator } from '../src/lib/record-labels';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MODULES = path.join(ROOT, 'packages/modules');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const has = (key: string): boolean => key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages) !== undefined;

/** Code ohne Kommentare und ohne Protokoll-Kurztexte (`summary`, bleiben nach dem Plan deutsch). */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/summary: `[^`]*`/g, '')
    .replace(/summary: '[^']*'/g, '');

/** Ein deutscher Wortlaut als Zeichenkette: Umlaut, zwei Wörter oder ein großgeschriebenes Wort vor einem Platzhalter. */
const GERMAN = /(['`])[^'`\n]*(?:[äöüÄÖÜß]|[A-Za-z]{2,} [a-zäöüß(]{2,}|[A-ZÄÖÜ][a-zäöüß]{2,} \$\{)[^'`\n]*\1/;

describe('Bezeichnungen von Haltern und Datensätzen (K2, Rest von Befund 49)', () => {
  it('stehen in den Haken der Module nicht als deutscher Satz, sondern als Schlüssel der Sprachdatei', () => {
    const checked = [
      path.join(MODULES, 'finance/src/ledger/holds.ts'),
      ...readdirSync(MODULES).map((m) => path.join(MODULES, m, 'src/record-labels.ts')).filter((f) => { try { return statSync(f).isFile(); } catch { return false; } }),
    ];
    const offenders = checked.flatMap((file) => code(file).split('\n').filter((line) => GERMAN.test(line)).map((line) => `${path.relative(ROOT, file)}: ${line.trim()}`));
    // Die Finanz-Haken `followUpTargets` und `recordLabels` stehen im Manifest.
    const manifest = code(path.join(MODULES, 'finance/src/manifest.ts'));
    const hooks = manifest.slice(manifest.indexOf('followUpTargets:'), manifest.indexOf('});', manifest.indexOf('recordLabels:')));
    offenders.push(...hooks.split('\n').filter((line) => GERMAN.test(line)).map((line) => `finance/src/manifest.ts: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });

  it('jeder Schlüssel, den ein Modul nennt, steht in der Sprachdatei', () => {
    const keys = new Set<string>();
    const sources = [...readdirSync(MODULES).map((m) => path.join(MODULES, m, 'src')), path.join(ROOT, 'packages/core/src')];
    for (const file of sources.flatMap(files).filter((f) => f.endsWith('.ts'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'([a-z]+\.records\.[A-Za-z.]+)'/g)) keys.add(match[1]!);
    }
    expect(keys.size).toBeGreaterThan(0);
    expect([...keys].filter((key) => !has(key))).toEqual([]);
  });

  it('die App übersetzt sie mit der Sprachdatei, ein Datum im Vereinsformat', () => {
    const translate = labelTranslator(createTestDeps());
    expect(translate('finance.records.notice', { date: '2024-02-29' })).toBe('Bescheid vom 29.02.2024');
    expect(translate('contacts.records.forbidden', {})).toBe('Kontakt (kein Zugriff)');
    expect(translate('finance.records.partnerPayment', { number: 'PZ-2026-001' })).toBe('Vorgang PZ-2026-001');
  });
});
