import { describe, expect, it } from 'vitest';
import { linkDocument, unlinkDocument } from '../src/service';
import { auditActions, fileFixture, setupWithTypes } from './helpers';

describe('links', () => {
  it('verknüpft dasselbe Dokument mit Empfänger und Betreff-Entität', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const a = await linkDocument(deps, ctx, {
      documentId: doc.id,
      entityType: 'contact',
      entityId: 'c-1',
      role: 'recipient',
    });
    const b = await linkDocument(deps, ctx, {
      documentId: doc.id,
      entityType: 'animal',
      entityId: 'a-1',
      role: 'about',
    });
    expect(a.ok && b.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.link');
  });

  it('legt denselben Bezug nicht doppelt an', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    await linkDocument(deps, ctx, {
      documentId: doc.id,
      entityType: 'contact',
      entityId: 'c-1',
      role: 'recipient',
    });
    const again = await linkDocument(deps, ctx, {
      documentId: doc.id,
      entityType: 'contact',
      entityId: 'c-1',
      role: 'recipient',
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.type).toBe('conflict');
  });

  it('löst einen Bezug wieder auf', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const linked = await linkDocument(deps, ctx, {
      documentId: doc.id,
      entityType: 'contact',
      entityId: 'c-1',
      role: 'recipient',
    });
    if (!linked.ok) throw new Error('link');
    const unlinked = await unlinkDocument(deps, ctx, { id: linked.value.id });
    expect(unlinked.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.unlink');
  });
});
