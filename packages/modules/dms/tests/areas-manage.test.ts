import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { countDocumentsOfType, createDocumentType, listDocumentAreas, updateDocumentType } from '../src/catalog';
import { documentTypes } from '../src/schema';
import { INCOMING_OPEN_TYPE, setupWithArea } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('setting the protection area of a document type (V14)', () => {
  it('dms.manage alone can neither set nor remove an area', async () => {
    const { deps, viewer } = await setupWithArea(); // viewer: alle Rechte der Akte, ohne probe.read
    expect(err(await updateDocumentType(deps, viewer, { key: INCOMING_OPEN_TYPE, protectionArea: 'probe' }))).toEqual({ type: 'forbidden', permission: 'probe.read' });
    expect(err(await updateDocumentType(deps, viewer, { key: 'secret', protectionArea: null }))).toEqual({ type: 'forbidden', permission: 'probe.read' });
    expect(err(await createDocumentType(deps, viewer, { key: 'vault', label: 'Tresor', prefix: 'TRS', defaultDirection: 'incoming', retentionClass: 'statutory10Y', protectionArea: 'probe' }))).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });

  it('with both permissions it works, and the audit log keeps before and after', async () => {
    const { deps, all } = await setupWithArea();
    expect(unwrap(await updateDocumentType(deps, all, { key: INCOMING_OPEN_TYPE, protectionArea: 'probe' })).protectionArea).toBe('probe');
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect([entry.action, JSON.parse(entry.before as string).protectionArea, JSON.parse(entry.after as string).protectionArea]).toEqual(['dms.type.update', null, 'probe']);
    expect(unwrap(await updateDocumentType(deps, all, { key: INCOMING_OPEN_TYPE, protectionArea: null })).protectionArea).toBeNull();
  });

  it('refuses an area nobody registered, and nobody can change one that has gone missing', async () => {
    const { deps, all } = await setupWithArea();
    expect(err(await updateDocumentType(deps, all, { key: INCOMING_OPEN_TYPE, protectionArea: 'nope' }))).toMatchObject({ type: 'conflict', code: 'unknownDocumentArea' });
    deps.db.update(documentTypes).set({ protectionArea: 'gone' }).where(eq(documentTypes.key, 'secret')).run();
    expect(err(await updateDocumentType(deps, all, { key: 'secret', protectionArea: null }))).toEqual({ type: 'forbidden', permission: 'dms.area:gone' });
  });

  it('the area of a module-owned type is fixed', async () => {
    const { deps, all } = await setupWithArea();
    expect(err(await updateDocumentType(deps, all, { key: 'probe-note', protectionArea: 'probe' }))).toMatchObject({ type: 'conflict', code: 'documentTypeOwnedByModule' });
  });

  it('lists the areas with what the caller holds, and counts the documents a change would hide', async () => {
    const { deps, all, viewer } = await setupWithArea();
    expect(unwrap(await listDocumentAreas(deps, all))).toEqual([{ key: 'probe', module: 'probe', permission: 'probe.read', held: true }]);
    expect(unwrap(await listDocumentAreas(deps, viewer))).toEqual([{ key: 'probe', module: 'probe', permission: 'probe.read', held: false }]);
    expect(err(await listDocumentAreas(deps, ctxWith(['dms.view'])))).toEqual({ type: 'forbidden', permission: 'dms.manage' });
    expect(unwrap(await countDocumentsOfType(deps, all, { key: 'secret' }))).toEqual({ count: 1 });
    expect(err(await countDocumentsOfType(deps, viewer, { key: 'secret' }))).toEqual({ type: 'forbidden', permission: 'probe.read' });
  });
});
