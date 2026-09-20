import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { BUNDLE_MAX_DOCUMENTS, resolveBundle } from '../src/bundle';
import { createDocumentFolder } from '../src/catalog';
import { linkDocumentInternal } from '../src/linked';
import { moveDocument } from '../src/service';
import { fileFixture, setupWithArea } from './helpers';

const withExport = <T extends { permissions: ReadonlySet<string> }>(ctx: T): T => ({ ...ctx, permissions: new Set([...ctx.permissions, 'documents.export']) });
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

async function world() {
  const s = await setupWithArea();
  for (const path of ['Finanzen', 'Finanzen/2026']) unwrap(await createDocumentFolder(s.deps, s.all, { path }));
  unwrap(await moveDocument(s.deps, s.all, { id: s.openId, folder: 'Finanzen' }));
  unwrap(await moveDocument(s.deps, s.all, { id: s.secretId, folder: 'Finanzen/2026' }));
  return { ...s, all: withExport(s.all), viewer: withExport(s.viewer), auditor: withExport(s.auditor) };
}

describe('resolveBundle', () => {
  it('needs documents.export, and the gate of the file module for folder and year', async () => {
    const { deps, openId } = await world();
    expect(err(resolveBundle(deps, ctxWith(['dms.view']), { documentIds: [openId] }))).toEqual({ type: 'forbidden', permission: 'documents.export' });
    expect(err(resolveBundle(deps, ctxWith(['documents.export']), { folder: 'Finanzen' }))).toEqual({ type: 'forbidden', permission: 'dms.view' });
    expect(resolveBundle(deps, ctxWith(['documents.export']), { documentIds: [openId] }).ok).toBe(true);
  });

  it('takes exactly one kind of selection', async () => {
    const { deps, all, openId } = await world();
    expect(err(resolveBundle(deps, all, {}))).toMatchObject({ type: 'validation' });
    expect(err(resolveBundle(deps, all, { folder: 'Finanzen', year: 2026 }))).toMatchObject({ type: 'validation' });
    expect(err(resolveBundle(deps, all, { documentIds: [openId], year: 2026 }))).toMatchObject({ type: 'validation' });
  });

  it('a folder means the folder and everything below it; drafts never come along', async () => {
    const { deps, all, openId, secretId } = await world();
    const res = unwrap(resolveBundle(deps, all, { folder: 'Finanzen' }));
    expect(res.rows.map((r) => r.row.id).sort()).toEqual([openId, secretId].sort());
    expect(res.title).toBe('Ordner Finanzen');
    expect(unwrap(resolveBundle(deps, all, { folder: 'Finanzen/2026' })).rows.map((r) => r.row.id)).toEqual([secretId]);
  });

  it('a year is the year of the document date', async () => {
    const { deps, all, secretId } = await world();
    const res = unwrap(resolveBundle(deps, all, { year: 2026 }));
    expect(res.rows.map((r) => r.row.id)).toContain(secretId);
    expect(res.title).toBe('Jahrgang 2026');
    expect(err(resolveBundle(deps, all, { year: 1999 }))).toMatchObject({ type: 'conflict', code: 'bundleEmpty' });
  });

  it('lists what the caller may not read, marked, instead of leaving it out', async () => {
    const { deps, viewer, auditor, secretId, openId } = await world();
    const forViewer = unwrap(resolveBundle(deps, viewer, { folder: 'Finanzen' })).rows;
    expect(forViewer.find((r) => r.row.id === secretId)).toMatchObject({ readable: false, protectedType: true });
    expect(forViewer.find((r) => r.row.id === openId)).toMatchObject({ readable: true });
    const forAuditor = unwrap(resolveBundle(deps, auditor, { folder: 'Finanzen' })).rows;
    expect(forAuditor.find((r) => r.row.id === openId)).toMatchObject({ readable: false, protectedType: false });
  });

  it('a module’s link makes a document readable — checked by the file module, link and permission both', async () => {
    const { deps, openId } = await world();
    const clerk = ctxWith(['documents.export', 'probe.read']);           // kein dms.view
    const access = [{ entityType: 'probeThing', entityId: 'T1' }];
    expect(unwrap(resolveBundle(deps, clerk, { documentIds: [openId], linkedAccess: access })).rows[0]!.readable).toBe(false); // kein Bezug
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: openId, entityType: 'probeThing', entityId: 'T1' }));
    expect(unwrap(resolveBundle(deps, clerk, { documentIds: [openId], linkedAccess: access })).rows[0]!.readable).toBe(true);
    expect(unwrap(resolveBundle(deps, ctxWith(['documents.export']), { documentIds: [openId], linkedAccess: access })).rows[0]!.readable).toBe(false); // kein Recht
    expect(unwrap(resolveBundle(deps, clerk, { documentIds: [openId], linkedAccess: [{ entityType: 'contact', entityId: 'C1' }] })).rows[0]!.readable).toBe(false); // kein angemeldeter Typ
  });

  it('refuses more than the limit, and says how many there are', async () => {
    const { deps, all } = await world();
    const ids = Array.from({ length: BUNDLE_MAX_DOCUMENTS + 1 }, (_, i) => `X${i}`);
    expect(err(resolveBundle(deps, all, { documentIds: ids }))).toMatchObject({ type: 'validation' }); // schon das Schema
  });

  it('orders by number unless asked for the date', async () => {
    const { deps, all } = await world();
    await fileFixture(deps, all);
    const byNumber = unwrap(resolveBundle(deps, all, { year: 2026 })).rows.map((r) => r.row.number);
    expect(byNumber).toEqual([...byNumber].sort());
  });
});
