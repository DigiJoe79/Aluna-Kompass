import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLog } from '../src/db/schema';
import { getDocument, listDocuments, nextDocumentNumber, renderDocument, voidDocument } from '../src/documents/service';
import type { DocumentTemplate } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const encoder = new TextEncoder();
const letter: DocumentTemplate<{ title: string }> = {
  key: 'test-letter',
  prefix: 'TST',
  schema: z.object({ title: z.string().min(1) }),
  render: async (data, ctx) => encoder.encode(`PDF ${ctx.number} ${data.title} ${ctx.organization['organization.name']}`),
};

function setup() {
  const deps = createTestDeps({ coreTemplates: [letter] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['documents.create', 'documents.view'], userId), userId };
}

describe('documents service', () => {
  it('renders with a gapless number per template and year, stores the PDF and audits', async () => {
    const { deps, ctx } = setup();
    const first = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Hallo' } }));
    const second = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Welt' }, entityType: 'user', entityId: 'U1' }));
    expect(first.number).toBe('TST-2026-001');
    expect(second.number).toBe('TST-2026-002');
    expect(second).toMatchObject({ status: 'issued', entityType: 'user', entityId: 'U1', inputSnapshot: { title: 'Welt' } });
    const file = unwrap(await getDocument(deps, ctx, second.id));
    expect(new TextDecoder().decode(file.bytes)).toBe('PDF TST-2026-002 Welt Neuer Verein');
    expect(file.filename).toBe('TST-2026-002.pdf');
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'documents.render')).toHaveLength(2);
    deps.clock.set('2027-01-02T09:00:00.000Z');
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Neu' } })).number).toBe('TST-2027-001');
    expect(nextDocumentNumber(deps.db, 'TST', 2026)).toBe('TST-2026-003');
  });

  it('validates input against the template schema and requires the permission', async () => {
    const { deps, ctx } = setup();
    const bad = await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: '' } });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.path === 'title').toBe(true);
    const unknown = await renderDocument(deps, ctx, { templateKey: 'nope', input: {} });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const denied = await renderDocument(deps, ctxWith(['documents.view']), { templateKey: 'test-letter', input: { title: 'x' } });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('voids a document once, keeps the file and number, and audits the reason', async () => {
    const { deps, ctx, userId } = setup();
    const doc = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x' } }));
    const voided = unwrap(await voidDocument(deps, ctx, { id: doc.id, reason: 'Tippfehler' }));
    expect(voided).toMatchObject({ status: 'voided', voidReason: 'Tippfehler', voidedByUserId: userId, number: 'TST-2026-001' });
    expect((await getDocument(deps, ctx, doc.id)).ok).toBe(true);
    const again = await voidDocument(deps, ctx, { id: doc.id, reason: 'nochmal' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'documentAlreadyVoided').toBe(true);
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Ersatz' } })).number).toBe('TST-2026-002');
  });

  it('lists newest first with filters and total', async () => {
    const { deps, ctx } = setup();
    unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'a' }, entityType: 'user', entityId: 'U1' }));
    deps.clock.advance(1000);
    unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'b' } }));
    const all = unwrap(await listDocuments(deps, ctx, {}));
    expect(all.total).toBe(2);
    expect(all.documents.map((d) => d.number)).toEqual(['TST-2026-002', 'TST-2026-001']);
    expect(unwrap(await listDocuments(deps, ctx, { entityType: 'user', entityId: 'U1' })).total).toBe(1);
    expect((await listDocuments(deps, ctxWith([]), {})).ok).toBe(false);
  });
});
