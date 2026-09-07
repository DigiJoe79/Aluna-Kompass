import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { TemplateSchema } from '../src/load';
import type { Finding } from '../src/resync/plan';
import { applyFindings } from '../src/resync/apply';
import { removeLocale } from '@kompass/core';
import { siteEntries, siteValues } from '../src/schema';

const schemaAfter = (): TemplateSchema => ({ name: 'T', locales: ['de'], uses: [], variables: {}, collections: {} });

describe('applyFindings', () => {
  it('renames a variable and keeps its content', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'subtitle', value: { de: 'Wer wir sind', en: '' }, updatedAt: 't' }).run();
    const findings: Finding[] = [{ kind: 'renamed', path: 'variables.lede', from: 'variables.subtitle', label: 'Einleitung', filled: 1 }];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'subtitle')).get()).toBeUndefined();
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'lede')).get()?.value).toEqual({ de: 'Wer wir sind', en: '' });
  });

  it('drops a removed variable and a removed collection with its entries', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'legacy', value: 'x', updatedAt: 't' }).run();
    deps.db.insert(siteEntries).values({ id: 'E1', collection: 'gone', data: { a: 1 }, createdAt: 't', updatedAt: 't' }).run();
    deps.db.insert(siteEntries).values({ id: 'E2', collection: 'keep', data: { a: 2 }, createdAt: 't', updatedAt: 't' }).run();
    const findings: Finding[] = [
      { kind: 'removed', path: 'variables.legacy', label: 'Legacy', filled: 1 },
      { kind: 'removed', path: 'collections.gone', label: 'Weg', filled: 1 },
    ];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).all()).toEqual([]);
    expect(deps.db.select().from(siteEntries).all().map((r) => r.id)).toEqual(['E2']);
  });

  it('strips a removed locale from every affected field, in variables and in entries', async () => {
    const deps = createTestDeps({ locales: ['de', 'en'] });
    insertUser(deps, { id: 'USER-TEST' });
    deps.db.insert(siteValues).values({ key: 'claim', value: { de: 'Hallo', en: 'Hi' }, updatedAt: 't' }).run();
    deps.db.insert(siteEntries).values({ id: 'E1', collection: 'articles', data: { title: { de: 'Titel', en: 'Title' } }, createdAt: 't', updatedAt: 't' }).run();
    unwrap(await removeLocale(deps, ctxWith(['settings.manage']), { code: 'en', confirm: true }));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'claim')).get()?.value).toEqual({ de: 'Hallo' });
    expect(deps.db.select().from(siteEntries).where(eq(siteEntries.id, 'E1')).get()?.data).toEqual({ title: { de: 'Titel' } });
  });

  it('converts a lossless retype and clears a lossy one', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'tags', value: 'hund', updatedAt: 't' }).run();
    deps.db.insert(siteValues).values({ key: 'note', value: ['a', 'b'], updatedAt: 't' }).run();
    const findings: Finding[] = [
      { kind: 'retyped', path: 'variables.tags', from: 'text', to: 'list', filled: 1, lossless: true, label: 'Tags' },
      { kind: 'retyped', path: 'variables.note', from: 'list', to: 'text', filled: 1, lossless: false, label: 'Notiz' },
    ];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'tags')).get()?.value).toEqual(['hund']);
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'note')).get()?.value).toBe('');
  });

  it('replaces a value that is gone with the named replacement', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'layout', value: 'full', updatedAt: 't' }).run();
    deps.db.insert(siteEntries).values({ id: 'E1', collection: 'sections', data: { width: 'full' }, createdAt: 't', updatedAt: 't' }).run();
    const findings: Finding[] = [
      { kind: 'valueGone', path: 'variables.layout', value: 'full', replacement: 'narrow', count: 1, label: 'Breite' },
      { kind: 'valueGone', path: 'collections.sections[].width', value: 'full', replacement: 'narrow', count: 1, label: 'Breite' },
    ];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'layout')).get()?.value).toBe('narrow');
    expect(deps.db.select().from(siteEntries).where(eq(siteEntries.id, 'E1')).get()?.data).toEqual({ width: 'narrow' });
  });

  it('creates nothing for an added field: it stays absent until someone fills it', () => {
    const deps = createTestDeps();
    const findings: Finding[] = [{ kind: 'added', path: 'variables.quote', label: 'Zitat' }];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).all()).toEqual([]);
  });
});
