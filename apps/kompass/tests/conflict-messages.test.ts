import { conflict, type ServiceError } from '@kompass/core';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { conflictMessage } from '@/lib/error-text';
import messages from '../messages/de.json';
import { type Allowlist, allowlistHygiene, fromRepo, isProductSource, messageAt, packageSourceDirs, read, sourceFiles, staleKeys } from './patterns/source';

/**
 * Regel 7: Jeder Konfliktcode hat einen Satz in de.json — im Kern und in jedem Modul. Ohne ihn zeigt die Oberfläche
 * „Der Vorgang ist nicht möglich: <deutscher Diensttext>“ (Durchsicht 2026-10-02, U1: 19 Codes der Webseite ohne
 * Text). Ein `conflict('code', …)` braucht einen Satz über `conflictMessage`, ein `localizedConflict('code', 'key')`
 * Grund und Abhilfe (`key.reason`, `key.remedy`). Bis zur Testdurchsicht 2026-10-22 galt das nur für die Webseite.
 */
type ConflictError = Extract<ServiceError, { type: 'conflict' }>;
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as Parameters<typeof conflictMessage>[1];
const textOf = (code: string, message = 'Technisch: Einzelheit') => conflictMessage(conflict(code, message).error as ConflictError, t);

/** Codes aus einem Template-String, die die Suche nicht sieht: `conflict(\`${kind}Failed\`, …)` in site/pipeline/jobs.ts, je Art aus SITE_JOB_KINDS. */
const DYNAMIC = ['previewFailed', 'deployCheckFailed', 'publishFailed'];

/** Code → Grund. Bedienfehler ohne Satz — leer seit der Testdurchsicht 2026-10-22; ein neuer Eintrag braucht einen Grund. */
export const WITHOUT_TEXT: Allowlist = {};

/**
 * Code → Grund. Codes, die keine Person im Verein bei der Arbeit trifft: Fehler eines Moduls, einer Vorlage oder der
 * Installation, oder nur über MCP erreichbar. Sie bekommen keinen Satz; die Oberfläche zeigt den Diensttext unter
 * `errors.conflict.default`, MCP den Diensttext. Was eine Bedienung in der Oberfläche auslösen kann, gehört nicht hierher.
 */
export const INTERNAL: Allowlist = {
  contactRoleConflict: 'Zwei Module melden dieselbe Kontaktrolle an — ein Fehler der Module, der Diensttext nennt beide.',
  documentBaseUnavailable: 'Die Basis einer Vorlage fehlt im Volume oder in der Installation — Installationsfehler.',
  documentImageInvalid: 'Eine Vorlage liefert ein Bild, das kein PNG/JPEG ist — Fehler des Moduls.',
  moduleInstallFailed: 'Die Einrichtung eines Moduls scheitert — Fehler des Moduls oder der Installation; der Diensttext trägt die Ursache.',
  reviewUiOnly: 'Nur über MCP: Die Oberfläche bestätigt die Prüfung selbst.',
  documentTypeNotOwned: 'issue() eines Moduls mit einer freien Art — Fehler des aufrufenden Moduls.',
  templateWithoutPermission: 'Eine Modulvorlage ohne Recht — Fehler des Moduls.',
  noLinkedRecord: 'receiveGeneratedUpload ohne angemeldeten Vorgang — Fehler des aufrufenden Moduls.',
  unknownDocumentArea: 'Die Oberfläche bietet nur angemeldete Schutzbereiche an; ein fremder Wert kommt nur über MCP.',
};

const sources = packageSourceDirs()
  .flatMap((dir) => sourceFiles(dir))
  .filter(isProductSource)
  .map((file) => ({ file: fromRepo(file), text: read(file) }));
const plain = [...new Set(sources.flatMap(({ text }) => [...text.matchAll(/\bconflict\(\s*'(\w+)'/g)].map((m) => m[1]!)))];
const localized = sources.flatMap(({ file, text }) => [...text.matchAll(/localizedConflict\(\s*'(\w+)',\s*'([\w.]+)'/g)].map((m) => ({ file, code: m[1]!, key: m[2]! })));
const withoutText = () => [...plain, ...DYNAMIC].filter((code) => textOf(code) === null);

describe('Konfliktcodes in Kern und Modulen', () => {
  it('findet die Codes aller Pakete (Gegenprobe gegen die bekannten)', () => {
    expect(plain).toEqual(expect.arrayContaining(['templateUnreadable', 'animalNotAdopted', 'slugTaken']));
    expect([...new Set(localized.map(({ file }) => file.split('/src/')[0]))]).toEqual(expect.arrayContaining(['packages/core', 'packages/modules/site']));
  });

  it('jeder Code hat einen Satz', () => {
    expect(withoutText().filter((code) => !(code in WITHOUT_TEXT) && !(code in INTERNAL))).toEqual([]);
  });

  allowlistHygiene(WITHOUT_TEXT, () => staleKeys(WITHOUT_TEXT, withoutText()));
  allowlistHygiene(INTERNAL, () => staleKeys(INTERNAL, withoutText()), 'Interne Codes');

  it('ein Code steht in höchstens einer der beiden Listen', () => {
    expect(Object.keys(INTERNAL).filter((code) => code in WITHOUT_TEXT)).toEqual([]);
  });

  it('jeder übersetzte Konflikt hat Grund und Abhilfe', () => {
    expect(localized.flatMap(({ file, code, key }) => [`${key}.reason`, `${key}.remedy`].filter((k) => messageAt(k) === undefined).map((k) => `${file} ${code}: ${k}`))).toEqual([]);
  });

  it('ein technisches Detail steht im Satz (Review Focus 5)', () => {
    expect(textOf('deployCheckFailed', 'rsync: exit 23')).toContain('exit 23');
    expect(textOf('templateUnreadable', 'Cannot find module x')).toContain('Cannot find module x');
  });
});
