import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, inFileOrLocalImport, isCommentLine, lineOf, read, relative, SRC, sourceFiles } from './source';

/**
 * Keine stille Grenze (docs/MUSTER.md § L, Spec 2026-10-08 § 5): Holt Seitencode unter `src/app` eine begrenzte
 * Liste (`limit:` mit Zahl oder Konstante), blättert die Seite (`ListPager`) oder nennt die Grenze
 * (`ListTruncated`) — in derselben Datei oder in der Liste aus ihrem Ordner, die sie einbindet. `limit: 1` zählt
 * nur und ist keine Liste. Ausnahmen je Datei mit Grund.
 *
 * Teil 2 (Designer 2026-10-08): Viele Dienste haben eine Standardgrenze im Schema (`limit: z.number()…default(50)`)
 * oder im Code (`.limit(… ?? 20)`). Ruft eine Seite sie ohne `limit:` auf, kürzt der Dienst still. Deshalb zählt
 * jeder Aufruf eines solchen Dienstes wie ein `limit:` — außer mit `limit: 1` (zählt nur) oder in `readAllPages(`
 * (liest alles). Welche Dienste das sind, liest der Wächter aus den Quellen der Pakete.
 */
const APP = path.join(SRC, 'app');

/** Zeilen mit einem Dienstaufruf-`limit:` (Zahl außer 1 oder Konstante); `limit: formatEuro(…)` ist ein Platzhalter. */
export function limitedCalls(text: string): number[] {
  return text.split('\n').flatMap((line, index) => (/\blimit:\s*(?!1\b)(\d+|[A-Z][A-Z0-9_]*)\b/.test(line) && !/^\s*(\/\/|\*)/.test(line) ? [index + 1] : []));
}

const NAMED = /<ListPager\b|<ListTruncated\b/;

const PACKAGES = path.resolve(SRC, '../../../packages');

/** Der Text ab `open` (eine öffnende Klammer) bis zur passenden schließenden. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && (depth -= 1) === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/**
 * Die exportierten Dienste einer Quelldatei mit Standardgrenze: Sie prüfen ihre Eingabe mit einem Schema, dessen
 * `limit` einen Standardwert hat, oder setzen die Grenze im Code (`.limit(x ?? 20)`).
 */
export function limitedServicesIn(text: string): string[] {
  const schemas = new Set<string>();
  for (const m of text.matchAll(/\bconst (\w+) = z\.object\(/g)) {
    if (/\blimit:\s*z\.number\(\)[^,\n]*\.default\(\d+\)/.test(balanced(text, m.index + m[0].length - 1))) schemas.add(m[1]!);
  }
  const starts = [...text.matchAll(/^export (?:async )?function (\w+)\b/gm)];
  return starts.flatMap((m, i) => {
    const body = text.slice(m.index, starts[i + 1]?.index ?? text.length);
    const viaSchema = [...body.matchAll(/\bvalidate\(\w+, (\w+)\b/g)].some((v) => schemas.has(v[1]!));
    return viaSchema || /\.limit\([^()]*\?\?\s*\d+\)/.test(body) ? [m[1]!] : [];
  });
}

/** Je Paket (`@kompass/…`) die Dienste mit Standardgrenze, aus dem `src` jedes Pakets unter `packages` und `packages/modules`. */
export function limitedServices(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const roots = readdirSync(PACKAGES).flatMap((name) => (name === 'modules' ? readdirSync(path.join(PACKAGES, name)).map((m) => path.join(PACKAGES, name, m)) : [path.join(PACKAGES, name)]));
  for (const root of roots) {
    if (!existsSync(path.join(root, 'package.json')) || !existsSync(path.join(root, 'src'))) continue;
    const pkg = (JSON.parse(read(path.join(root, 'package.json'))) as { name: string }).name;
    const names = sourceFiles(path.join(root, 'src')).flatMap((file) => limitedServicesIn(read(file)));
    if (names.length > 0) found.set(pkg, new Set(names));
  }
  return found;
}

/**
 * Zeilen, in denen Seitencode einen Dienst mit Standardgrenze aufruft — nach Name und Paket des Imports, auch
 * umbenannt und über mehrere Zeilen. Nicht gezählt: `limit: 1` und Aufrufe in `readAllPages(`.
 */
export function defaultLimitedCalls(text: string, services: Map<string, Set<string>>): number[] {
  const locals: string[] = [];
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(@kompass\/[^']+)'/g)) {
    const known = services.get(m[2]!);
    if (!known) continue;
    for (const spec of m[1]!.split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type '))) {
      const [name, alias] = spec.split(/\s+as\s+/);
      if (known.has(name!)) locals.push(alias ?? name!);
    }
  }
  const lines = text.split('\n');
  return locals.flatMap((local) =>
    [...text.matchAll(new RegExp(`(?<![\\w.])${local}\\(`, 'g'))].flatMap((m) => {
      const line = lineOf(text, m.index);
      const source = lines[line - 1]!;
      if (isCommentLine(source) || /readAllPages\(/.test(source)) return [];
      return /\blimit:\s*1\b/.test(balanced(text, m.index + local.length)) ? [] : [line];
    }),
  );
}

const SERVICES = limitedServices();

const ALLOWED: Allowlist = {
  'app/admin/audit/export/route.ts': 'PDF-Auszug des Protokolls, keine Liste der Oberfläche; die Grenze von 200 gehört zum Auszug (Backlog 34).',
  'app/(shell)/contacts/search-action.ts': 'Kontaktauswahl (Kombobox): höchstens 20 Treffer, darunter „Weitere Treffer — bitte suchen.“',
  'app/(shell)/dms/search-action.ts': 'Dokumentauswahl (Kombobox): höchstens 20 Treffer zum Wählen, keine Liste.',
  'app/(shell)/finance/entries/actions.ts': 'Server-Aktion „Geprüfte festschreiben“: blättert selbst über alle Seiten zu 200.',
  'app/(shell)/finance/work/actions.ts': '„Beleg suchen“ (wählt einen Wert, MUSTER § L): die 20 besten Treffer zum Kontoumsatz, Standardgrenze des Dienstes; für alles Weitere führt „In der Akte suchen“ mit den Suchbegriffen in die Akte.',
  'app/(shell)/finance/cash/page.tsx': 'Letzte Zählungen und letzte 10 Bewegungen der Kasse mit Link „Zum Journal“ — ein Auszug, keine Liste.',
};

const offenders = () =>
  sourceFiles(APP)
    .filter((file) => [...limitedCalls(read(file)), ...defaultLimitedCalls(read(file), SERVICES)].length > 0 && !inFileOrLocalImport(file, NAMED))
    .map(relative);

describe('keine stille Grenze', () => {
  describe('Heuristik', () => {
    it('trifft limit mit Zahl oder Konstante, nicht limit: 1 und keinen Platzhalter', () => {
      expect(limitedCalls(`listX(deps, ctx, { limit: 200 });\nlistY(deps, ctx, { limit: PAGE_SIZE, offset });`)).toEqual([1, 2]);
      expect(limitedCalls(`count(deps, ctx, { limit: 1 });`)).toEqual([]);
      expect(limitedCalls(`t('hint', { limit: formatEuro(cents) })`)).toEqual([]);
    });

    it('liest Standardgrenzen aus Schema und Code, nicht ohne default', () => {
      const source = [
        "const listSchema = z.object({",
        "  state: z.enum(['a']).optional(),",
        "  limit: z.number().int().min(1).max(200).default(50),",
        "});",
        "const openSchema = z.object({ limit: z.number().int().min(1).max(200).optional() });",
        "export async function listThings(deps: Deps, ctx: CallContext, input: unknown) {",
        "  const parsed = validate(deps, listSchema, input);",
        "}",
        "export async function listOpen(deps: Deps, ctx: CallContext, input: unknown) {",
        "  const parsed = validate(deps, openSchema, input);",
        "}",
        "export function listRecent(deps: Deps, ctx: CallContext, input: unknown) {",
        "  const parsed = validate(deps, openSchema, input);",
        "  return db.select().limit(parsed.value.limit ?? 20).all();",
        "}",
      ].join('\n');
      expect(limitedServicesIn(source)).toEqual(['listThings', 'listRecent']);
    });

    it('kennt die Dienste mit Standardgrenze der Pakete (Gegenprobe gegen die bekannten)', () => {
      expect([...(SERVICES.get('@kompass/core') ?? [])]).toContain('queryAudit');
      expect([...(SERVICES.get('@kompass/module-contacts') ?? [])]).toContain('listContacts');
      expect([...(SERVICES.get('@kompass/module-dms') ?? [])]).toContain('listDocuments');
      expect([...(SERVICES.get('@kompass/module-site') ?? [])]).toEqual(['listPublishes']);
      expect([...(SERVICES.get('@kompass/module-finance') ?? [])].sort()).toEqual(
        [
          'getDonationBook',
          'listAllocationCorrections',
          'listApprovals',
          'listCashCounts',
          'listConfirmationRuns',
          'listConfirmations',
          'listEntries',
          'listImportRuns',
          'listMyExpenseClaims',
          'listOpenItems',
          'listRawTransactions',
          'listUncertifiedDonations',
          'listVouchersWithoutEntry',
          'listWorkItems',
          'searchVouchersForTransaction',
        ].sort(),
      );
      expect(SERVICES.has('@kompass/module-animals')).toBe(false);
    });

    it('zählt Aufrufe ohne limit nach Paket und Name, auch umbenannt und mehrzeilig; nicht limit: 1 und readAllPages', () => {
      const services = new Map([['@kompass/module-finance', new Set(['listEntries', 'listOpenItems'])]]);
      const page = [
        "import { listEntries as entries, listOpenItems } from '@kompass/module-finance';",
        "import { listEntries as siteEntries } from '@kompass/module-site';",
        "const a = await entries(deps, ctx, {",
        "  state: 'draft',",
        "});",
        "const b = await entries(deps, ctx, { limit: 1 });",
        "const c = await siteEntries(deps, ctx, 'hunde');",
        "const d = await readAllPages((page) => listOpenItems(deps, ctx, { ...page }), (v) => v.items);",
        "const e = await listOpenItems(deps, ctx, { state: 'open' });",
        "// listOpenItems(deps, ctx, {}) im Kommentar",
      ].join('\n');
      expect(defaultLimitedCalls(page, services)).toEqual([3, 9]);
      expect(defaultLimitedCalls(page.replace("from '@kompass/module-finance'", "from '@kompass/module-projects'"), services)).toEqual([]);
    });

    it('findet ListPager auch in der Liste, die die Seite einbindet', () => {
      expect(inFileOrLocalImport(path.join(APP, '(shell)/contacts/page.tsx'), NAMED)).toBe(true);
      expect(inFileOrLocalImport(path.join(APP, '(shell)/finance/cash/page.tsx'), NAMED)).toBe(false);
      // über zwei Dateien: Seite → Client → Verlauf mit `ListTruncated`
      expect(inFileOrLocalImport(path.join(APP, '(shell)/site/publish/page.tsx'), NAMED)).toBe(true);
    });
  });

  it('jede begrenzte Liste blättert oder nennt die Grenze', () => {
    expect(offenders().filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const hits = new Set(offenders());
    expect(Object.keys(ALLOWED).filter((file) => !hits.has(file))).toEqual([]);
  });
});
