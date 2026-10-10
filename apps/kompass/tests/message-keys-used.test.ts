import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * Gegenstück zu `message-keys.test.ts` (Design-Nachtrag Phase 4, Teil C
 * Task 2): Jeder Schlüssel in `de.json` wird irgendwo im Code gebraucht. Ein
 * Umbau, der eine Beschriftung ersetzt, lässt sonst die alte stehen — sie
 * kostet jede weitere Sprache eine Übersetzung, die niemand sieht.
 *
 * Geprüft wird großzügig, damit der Wächter nicht lügt, wenn er rot wird. Ein
 * Schlüssel gilt als gebraucht, wenn
 *   (a) sein voller Pfad als Zeichenkette im Code steht (bei `.reason` und
 *       `.remedy` genügt der Pfad davor, wie `localizedConflict` ihn nimmt),
 *   (b) ein Vorlagen-String mit mindestens zwei festen Stufen davor steht
 *       (`\`finance.errors.${code}\``),
 *   (c) eine Datei den Namensraum bindet (`useTranslations('ns')`) und den
 *       Rest als Zeichenkette nennt, als Vorlage beginnt (`t(\`kinds.${k}\`)`)
 *       oder nach einer ersten Einsetzung fortsetzt (`t(\`${mode}.title\`)`),
 *   (d) eine Datei den direkten Elternnamensraum bindet und den Übersetzer
 *       mit einem berechneten Schlüssel ruft (`t(step)`), und das letzte Glied
 *       irgendwo als Zeichenkette steht (`RUN_STEPS`, `banner.kind`).
 * Was sich so nicht finden lässt, steht unten in `DYNAMIC` — mit dem Ort, der
 * den Schlüssel zusammensetzt.
 */
const REPO = path.resolve(import.meta.dirname, '../../..');
const SOURCES = ['apps/kompass/src', 'packages'].map((dir) => path.join(REPO, dir));
const SKIP_DIRS = new Set(['node_modules', 'tests', 'dist', '.astro', 'drizzle', '.next']);

const DYNAMIC: { prefix: RegExp; where: string }[] = [
  { prefix: /^folderTree\.(block|announce)\./, where: 'components/folder-tree/announcements.ts — `block.${reason}` und die Ansagen, mit dem Übersetzer des Baums' },
  { prefix: /^nav\./, where: 'apps/kompass/src/lib/navigation.ts — `nav.${item.key}` aus den Menüeinträgen von Kern und Modulen' },
  { prefix: /^(content|[a-z]+\.common)\.(moduleInactiveTitle|moduleInactiveText|openModules)$/, where: 'components/module-inactive-card.tsx — `getTranslations(namespace)` mit dem Namensraum des Moduls' },
  { prefix: /^contacts\.roleNames\./, where: 'lib/contact-roles.ts — `roleNames.${key}` mit dem Übersetzer des Aufrufers' },
  { prefix: /^settings\.managedHint\./, where: 'lib/settings-fields.ts — `managedHintKey()` liefert `managedHint.${tab}`' },
  { prefix: /^finance\.taxText\./, where: 'lib/finance/tax-text.ts — `taxTextKey()` liefert den Schlüssel' },
  { prefix: /^site\.publish\.flow\.end\.(success\.title|failed|failedPreview|cancelled|timeout|interrupted|cache)/, where: 'app/(shell)/site/publish/end-text.ts — endTitle/endText mit dem Übersetzer des Namensraums site.publish' },
  { prefix: /^common\.conflict\.(compare|reload)$/, where: 'lib/conflict-remedies.ts — `conflictRemedies()` löst die Auswege mit dem Übersetzer der Leiste auf' },
  { prefix: /^finance\.channel\./, where: 'lib/finance/channel.ts — `channelKey()` liefert den Schlüssel' },
  { prefix: /^audit\.actions\./, where: 'lib/audit-actions.ts — `auditActionKey()` macht aus der Aktion des Protokolls den Schlüssel (Punkte → Unterstriche)' },
  { prefix: /^audit\.sentences\./, where: 'lib/audit-sentences.ts — `auditSentenceKey()` macht aus der Aktion des Protokolls den Schlüssel des Satzes (Punkte → Unterstriche)' },
  { prefix: /^audit\.entities\./, where: 'lib/audit-entities.ts — `auditEntityWord()` nimmt den Typ des Protokolls als Schlüssel (`entities.${entityType}`)' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(full);
    return /\.(tsx?|mts)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

function leafKeys(node: unknown, prefix: string[] = []): string[] {
  if (typeof node !== 'object' || node === null) return [prefix.join('.')];
  return Object.entries(node).flatMap(([key, value]) => leafKeys(value, [...prefix, key]));
}

interface FileFacts {
  namespaces: Set<string>;
  literals: Set<string>;
  templatePrefixes: Set<string>;
  /** Vorlagen, die mit einer Einsetzung beginnen: `${device}.step1` → `.step1`. */
  templateSuffixes: Set<string>;
  computedCall: boolean;
}

const BINDING = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*(?:'([^']*)')?/g;

/** Kommentare zuerst weg: Ein `code` darin brächte die Paare der Backticks durcheinander. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function factsOf(raw: string): FileFacts {
  const source = withoutComments(raw);
  const literals = new Set<string>();
  const templatePrefixes = new Set<string>();
  for (const m of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) literals.add(m[1] ?? m[2] ?? '');
  // Der feste Anfang jeder Vorlage, auch einer geschachtelten (`${t(`target.${env}`)}`).
  for (const m of source.matchAll(/`([^`$]*)\$\{/g)) templatePrefixes.add(m[1] ?? '');
  for (const m of source.matchAll(/`([^`$]*)`/g)) literals.add(m[1] ?? '');
  const templateSuffixes = new Set<string>();
  for (const m of source.matchAll(/`\$\{[^}`]*\}(\.[^`$]+)`/g)) templateSuffixes.add(m[1]!);
  const namespaces = new Set<string>();
  let computedCall = false;
  for (const m of source.matchAll(BINDING)) {
    namespaces.add(m[2] ?? '');
    if (new RegExp(`\\b${m[1]}(?:\\.rich|\\.markup|\\.has)?\\(\\s*[A-Za-z_(]`).test(source)) computedCall = true;
  }
  return { namespaces, literals, templatePrefixes, templateSuffixes, computedCall };
}

const facts = SOURCES.flatMap(sourceFiles).map((file) => factsOf(readFileSync(file, 'utf8')));
const allLiterals = new Set(facts.flatMap((f) => [...f.literals]));
const allPrefixes = new Set(facts.flatMap((f) => [...f.templatePrefixes]));

function used(key: string): boolean {
  const parts = key.split('.');
  if (allLiterals.has(key)) return true;
  if ((parts.at(-1) === 'reason' || parts.at(-1) === 'remedy') && allLiterals.has(parts.slice(0, -1).join('.'))) return true;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 2; j < parts.length; j++) if (allPrefixes.has(`${parts.slice(i, j).join('.')}.`)) return true;
  }
  return facts.some((f) => {
    for (const ns of f.namespaces) {
      if (ns && !key.startsWith(`${ns}.`)) continue;
      const rest = (ns ? key.slice(ns.length + 1) : key).split('.');
      if (f.literals.has(rest.join('.'))) return true;
      for (let i = 1; i < rest.length; i++) if (f.templatePrefixes.has(`${rest.slice(0, i).join('.')}.`)) return true;
      if (rest.length > 1 && f.templateSuffixes.has(`.${rest.slice(1).join('.')}`)) return true;
      if (rest.length === 1 && f.computedCall && allLiterals.has(rest[0]!)) return true;
    }
    return false;
  });
}

describe('Übersetzungsschlüssel', () => {
  it('werden alle im Code gebraucht (Ausnahmen mit Ort in DYNAMIC)', () => {
    const unused = leafKeys(messages).filter((key) => !DYNAMIC.some((d) => d.prefix.test(key)) && !used(key));
    expect(unused).toEqual([]);
  });

  it('jede Ausnahme deckt noch mindestens einen Schlüssel', () => {
    const keys = leafKeys(messages);
    expect(DYNAMIC.filter((d) => !keys.some((key) => d.prefix.test(key))).map((d) => d.where)).toEqual([]);
  });
});
