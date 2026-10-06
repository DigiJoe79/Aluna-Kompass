import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC } from './source';

/**
 * Stammdaten (etwas, das man pflegt) werden auf einer eigenen Seite angelegt, nicht in einem Dialog
 * über der Liste (docs/MUSTER.md § C): Die Seite hat eine Adresse, einen Rückweg und einen Platz für
 * Fehlermeldungen. Angelegt wird entweder auf `…/new/page.tsx` oder — wie bei Tieren und Projekten —
 * auf `…/[id]/page.tsx`, das die Kennung `new` kennt. Die Listenseite hat keine `Create…Dialog` als
 * Kopfzeilen-Aktion.
 */
const STAMMDATEN = ['animals', 'projects', 'finance/partners', 'site/c/[collection]'];

/** Ausnahmen von der Regel — Pfad → Grund. Der Test verlangt, dass sie wahr bleiben. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  contacts:
    'Kontakte sind noch Lesesicht mit Bearbeiten-Dialog und Anlegen im Dialog; die Umstellung auf das Stammdatenmuster ist zurückgestellt (Entscheidung des Maintainers, 2026-10-04).',
};

const MODULE_ROOT = path.join(SRC, 'app/(shell)');
const dir = (module: string) => path.join(MODULE_ROOT, module);

function createsOnItsOwnPage(module: string): boolean {
  if (existsSync(path.join(dir(module), 'new/page.tsx'))) return true;
  const detail = path.join(dir(module), '[id]/page.tsx');
  return existsSync(detail) && /===\s*'new'/.test(readFileSync(detail, 'utf8'));
}

function createsInDialogFromHeader(module: string): boolean {
  const list = path.join(dir(module), 'page.tsx');
  if (!existsSync(list)) return false;
  return /actions=\{[^}]*Create\w*Dialog/.test(readFileSync(list, 'utf8'));
}

describe('Stammdaten legt man auf einer eigenen Seite an', () => {
  it.each(STAMMDATEN)('%s hat eine Seite zum Anlegen und keinen Dialog in der Kopfzeile', (module) => {
    expect(createsOnItsOwnPage(module), `${module}: weder new/page.tsx noch [id]/page.tsx mit 'new'`).toBe(true);
    expect(createsInDialogFromHeader(module), `${module}: Create…Dialog als PageHeader-Aktion`).toBe(false);
  });

  it('jede Ausnahme gilt noch', () => {
    // Sobald ein ausgenommenes Modul die Regel erfüllt, gehört es in STAMMDATEN und nicht hierher.
    for (const module of Object.keys(EXCEPTIONS)) {
      expect(createsOnItsOwnPage(module), `${module} erfüllt die Regel jetzt — aus EXCEPTIONS nach STAMMDATEN verschieben`).toBe(false);
    }
  });
});
