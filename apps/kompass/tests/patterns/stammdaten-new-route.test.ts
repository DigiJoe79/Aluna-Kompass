import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, read, relative, sourceFiles, SRC } from './source';

/**
 * Stammdaten (etwas, das man pflegt) werden auf einer eigenen Seite angelegt, nicht in einem Dialog
 * über der Liste (docs/MUSTER.md § C): Die Seite hat eine Adresse, einen Rückweg und einen Platz für
 * Fehlermeldungen. Angelegt wird entweder auf `…/new/page.tsx` oder — wie bei Tieren und Projekten —
 * auf `…/[id]/page.tsx`, das die Kennung `new` kennt. Die Listenseite hat keine `Create…Dialog` als
 * Kopfzeilen-Aktion.
 *
 * Geprüft wird jede Liste unter `app/(shell)` mit einer Detailseite `[id]/page.tsx` — die Ziele kommen aus der
 * Struktur, ein neues Modul fällt von selbst darunter (Testdurchsicht 2026-10-22).
 */
const SHELL = path.join(SRC, 'app/(shell)');

/** Ausnahmen von der Regel — Ordner relativ zu `app/(shell)` → Grund. */
export const EXCEPTIONS: Allowlist = {
  contacts:
    'Kontakte sind noch Lesesicht mit Bearbeiten-Dialog und Anlegen im Dialog; die Umstellung auf das Stammdatenmuster ist zurückgestellt (Entscheidung des Maintainers, 2026-10-04).',
  'governance/statutes': 'Satzungsstände sind Vorgänge (MUSTER § C): „Stand anlegen“ legt den Entwurf auf Basis des gültigen Stands an und öffnet ihn zum Bearbeiten (Plan U2, Board 5a).',
  'governance/resolutions': 'Beschlüsse entstehen nur beim Festschreiben einer Sitzung oder eines Umlaufs (Spec § 5.4, § 5.6), nie von Hand.',
  'animals/proposals': 'Vorschläge kommen über den Eingang (Agent, Abgleich), keiner wird von Hand angelegt; die Liste verweist zum Anlegen auf /animals/new.',
};

/** Die Listen: Ordner unter `app/(shell)` mit `page.tsx` und `[id]/page.tsx`. */
export const lists = (): string[] =>
  sourceFiles(SHELL)
    .filter((file) => file.endsWith(`${path.sep}[id]${path.sep}page.tsx`))
    .map((file) => path.dirname(path.dirname(file)))
    .filter((dir) => existsSync(path.join(dir, 'page.tsx')))
    .map((dir) => path.relative(SHELL, dir).split(path.sep).join('/'))
    .sort();

const dir = (list: string) => path.join(SHELL, list);

function createsOnItsOwnPage(list: string): boolean {
  if (existsSync(path.join(dir(list), 'new/page.tsx'))) return true;
  return /===\s*'new'/.test(read(path.join(dir(list), '[id]/page.tsx')));
}

const createsInDialogFromHeader = (list: string): boolean => /actions=\{[^}]*Create\w*Dialog/.test(read(path.join(dir(list), 'page.tsx')));

const breaksRule = (list: string): boolean => !createsOnItsOwnPage(list) || createsInDialogFromHeader(list);

describe('Stammdaten legt man auf einer eigenen Seite an', () => {
  it('findet die Listen aus der Struktur (Gegenprobe gegen die bekannten)', () => {
    expect(lists()).toEqual(expect.arrayContaining(['animals', 'projects', 'finance/partners', 'site/c/[collection]', 'contacts']));
    expect(relative(path.join(dir('animals'), 'page.tsx'))).toBe('app/(shell)/animals/page.tsx');
  });

  it('jede Liste mit Detailseite hat eine Seite zum Anlegen und keinen Dialog in der Kopfzeile', () => {
    const offenders = lists().filter((list) => !(list in EXCEPTIONS) && breaksRule(list));
    expect(offenders, 'weder new/page.tsx noch [id]/page.tsx mit `new`, oder Create…Dialog als PageHeader-Aktion').toEqual([]);
  });

  // Sobald eine ausgenommene Liste die Regel erfüllt, gehört sie nicht mehr hierher.
  allowlistHygiene(EXCEPTIONS, () => Object.keys(EXCEPTIONS).filter((list) => !lists().includes(list) || !breaksRule(list)));
});
