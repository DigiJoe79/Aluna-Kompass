import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { listHandbookDocs, parseHandbookIndex, readHandbookIndex, readHandbookPage } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { CORE_HELP } from '@/lib/help';
import { installedModules } from '@/modules';

/**
 * Das Handbuch ist Teil der Auslieferung. Eine Seite, die ein Manifest nennt,
 * muss existieren; eine Seite, die existiert, muss im Inhaltsverzeichnis
 * stehen; und jede beginnt mit Titel und Kurzabsatz — das Panel zeigt genau
 * den, und eine leere Hilfe ist schlimmer als keine.
 */
const env = { handbookDir: path.resolve(import.meta.dirname, '../../../docs/handbuch') };
const docs = listHandbookDocs(env);
const chapters = parseHandbookIndex(readHandbookIndex(env));
const indexed = chapters.flatMap((c) => c.pages);

describe('das Handbuch', () => {
  it('hat jede Seite, die eine Route nennt', () => {
    const named = [...CORE_HELP, ...installedModules.flatMap((m) => m.help ?? [])].map((h) => h.doc);
    expect(named.filter((doc) => !docs.includes(doc))).toEqual([]);
  });

  it('führt jede Seite genau einmal im Inhaltsverzeichnis, mit dem Titel der Datei', () => {
    const counts = new Map<string, number>();
    for (const page of indexed) counts.set(page.doc, (counts.get(page.doc) ?? 0) + 1);
    expect(docs.filter((doc) => counts.get(doc) !== 1)).toEqual([]);
    expect(indexed.filter((page) => !docs.includes(page.doc)).map((p) => p.doc)).toEqual([]);
    const wrongTitle = indexed.filter((page) => readHandbookPage(env, page.doc)?.title !== page.title).map((p) => p.doc);
    expect(wrongTitle).toEqual([]);
  });

  it('beginnt auf jeder Seite mit Titel und Kurzabsatz', () => {
    const broken = docs.filter((doc) => {
      const page = readHandbookPage(env, doc);
      return !page || page.title === '' || page.lead === '';
    });
    expect(broken).toEqual([]);
  });

  it('verweist nur auf Bilder und Seiten, die es gibt', () => {
    const missing: string[] = [];
    for (const doc of docs) {
      const body = readHandbookPage(env, doc)!.body;
      const dir = path.posix.dirname(doc);
      for (const [, target] of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|\[[^\]]*\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g).toArray().map((m) => [m[0], m[1] ?? m[2]] as const)) {
        if (!target) continue;
        const rel = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
        if (!existsSync(path.join(env.handbookDir, rel))) missing.push(`${doc}: ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
