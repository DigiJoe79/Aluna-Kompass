import { coreModule, createRegistry } from '@kompass/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { auditActionKey, auditActionLabel } from '@/lib/audit-actions';
import { installedModules } from '@/modules';

const labels = messages.audit.actions as Record<string, string>;
const t = Object.assign((key: string) => labels[key.replace(/^actions\./, '')]!, { has: (key: string) => key.replace(/^actions\./, '') in labels });

const REPO = path.resolve(import.meta.dirname, '../../..');
/** Der Katalog einer Installation mit allen Modulen (Spec Protokoll § 3). */
const catalog = createRegistry([coreModule, ...installedModules]).auditActions;
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return ['node_modules', 'tests', 'dist', '.next', 'drizzle'].includes(name) ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** Spec Filterleisten § 4: Der Filter „Aktion“ zeigt Klartext. */
describe('Aktionen des Protokolls in Worten', () => {
  it('nimmt den Klartext und fällt ohne Eintrag auf den Schlüssel zurück', () => {
    expect(auditActionKey('dms.dispatch.clear')).toBe('actions.dms_dispatch_clear');
    expect(auditActionLabel(t, 'animals.update')).toBe('Hund geändert');
    expect(auditActionLabel(t, 'kennt.niemand')).toBe('kennt.niemand');
  });

  it('jede Aktion, die ein Dienst wörtlich protokolliert, hat einen Klartext', () => {
    const found = new Set<string>();
    for (const file of [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'apps/kompass/src'))]) {
      for (const match of readFileSync(file, 'utf8').matchAll(/action: '([a-zA-Z]+\.[a-zA-Z.]+)'/g)) found.add(match[1]!);
    }
    expect(found.size).toBeGreaterThan(100);
    expect([...found].filter((action) => !t.has(auditActionKey(action)))).toEqual([]);
  });

  /** Spec Protokoll § 6, Wächter 1: Katalog und Klartexte laufen nicht auseinander. */
  it('jede Aktion, die ein Dienst wörtlich protokolliert, steht im Katalog eines Manifests', () => {
    const found = new Set<string>();
    for (const file of [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'apps/kompass/src'))]) {
      for (const match of readFileSync(file, 'utf8').matchAll(/action: '([a-zA-Z]+\.[a-zA-Z.]+)'/g)) found.add(match[1]!);
      // Aktionen, die `writeSettingInternal` als letztes Argument bekommt.
      for (const match of readFileSync(file, 'utf8').matchAll(/writeSettingInternal\((?:[^;]*?), '([a-zA-Z]+\.[a-zA-Z.]+)'\s*,?\s*\)/g)) found.add(match[1]!);
    }
    expect([...found].filter((action) => !catalog.has(action) && !NOT_AUDIT_ACTIONS.has(action))).toEqual([]);
  });

  it('jede Aktion im Katalog hat einen Klartext, und jeder Klartext gehört zu einer Aktion im Katalog', () => {
    expect([...catalog.keys()].filter((action) => !t.has(auditActionKey(action)))).toEqual([]);
    const keys = new Set([...catalog.keys()].map((action) => action.replaceAll('.', '_')));
    expect(Object.keys(labels).filter((key) => !keys.has(key))).toEqual([]);
  });

  /**
   * Die strenge Prüfung in `recordAudit` ließe eine Handlung im Betrieb scheitern, wenn eine Aktion im Katalog
   * fehlt. Steht jede Aktion als fester Text im Aufruf, findet der Quell-Scan oben jede — und die Unit-Tests ohne
   * Umweg über den Betrieb.
   */
  it('jede Aktion steht als fester Text im Aufruf von recordAudit, financeAudit und writeSettingInternal', () => {
    const offenders: string[] = [];
    for (const file of [...sources(path.join(REPO, 'packages')), ...sources(path.join(REPO, 'apps/kompass/src'))]) {
      const rel = path.relative(REPO, file);
      if (rel in DYNAMIC_ACTION_ALLOWED) continue;
      offenders.push(...dynamicActions(readFileSync(file, 'utf8')).map((hit) => `${rel}: ${hit}`));
    }
    expect(offenders).toEqual([]);
  });

  it('der Wächter findet eine Aktion aus einem Ausdruck', () => {
    expect(dynamicActions("recordAudit(tx, deps, ctx, { action: `x.${y}`, entityType: 'a', entityId: null });")).toHaveLength(1);
    expect(dynamicActions("financeAudit(tx, deps, ctx, { action: ok ? 'finance.a' : 'finance.b', entity: 'x', id: '1' });")).toHaveLength(1);
    expect(dynamicActions("writeSettingInternal(tx, deps, ctx, 'k', v, kind);")).toHaveLength(1);
    expect(dynamicActions("recordAudit(tx, deps, ctx, { action: 'a.b', entityType: 'a', entityId: null });")).toEqual([]);
    expect(dynamicActions("writeSettingInternal(tx, deps, ctx, 'k', v);")).toEqual([]);
  });
});

/** Strings, die wie eine Aktion aussehen, aber keine sind (Schlüssel einer Einstellung im Muster oben). */
const NOT_AUDIT_ACTIONS = new Set<string>([]);

/** Datei → Grund. Nur Stellen, die die Aktion bloß durchreichen und selbst nur feste Texte bekommen. */
const DYNAMIC_ACTION_ALLOWED: Record<string, string> = {
  'packages/core/src/audit/log.ts': 'recordAudit selbst: `action: input.action`.',
  'packages/core/src/settings/service.ts': 'writeSettingInternal selbst: reicht seinen Parameter `action` durch.',
  'packages/core/src/themes/service.ts': '`saveThemes(…, action)` bekommt nur feste Texte (themes.create, themes.update, themes.duplicate, themes.delete).',
  'packages/modules/finance/src/audit.ts': 'financeAudit selbst: `action: entry.action`, typisiert als `finance.${string}`.',
};

/** Aufrufe, deren Aktion kein fester Text ist. */
function dynamicActions(source: string): string[] {
  const hits: string[] = [];
  for (const call of calls(source, /\b(recordAudit|financeAudit)\(/g)) {
    for (const m of call.matchAll(/\baction:\s*([^,}\n]+)/g)) if (!/^'[^']*'\s*$/.test(m[1]!)) hits.push(m[0]!.trim());
  }
  for (const call of calls(source, /\bwriteSettingInternal\(/g)) {
    const args = splitArgs(call.slice(call.indexOf('(') + 1, -1));
    if (args.length >= 6 && !/^'[^']*'$/.test(args[5]!.trim())) hits.push(`writeSettingInternal(…, ${args[5]!.trim()})`);
  }
  return hits;
}

/** Der Text jedes Aufrufs bis zur passenden schließenden Klammer. */
function calls(source: string, start: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(start)) {
    let depth = 0;
    for (let i = m.index! + m[0].length - 1; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) {
        out.push(source.slice(m.index!, i + 1));
        break;
      }
    }
  }
  return out;
}

/** Argumente auf oberster Ebene (Klammern, Objekte, Felder und Zeichenketten zählen mit). */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current);
  return args;
}
