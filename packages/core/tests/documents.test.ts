import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLog, mediaFolders } from '../src/db/schema';
import { exportDocument, getDocument, listDocumentBases, listDocuments, nextDocumentNumber, renderDocument, voidDocument } from '../src/documents/service';
import type { DocumentTemplate } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { setSetting } from '../src/settings/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const letter: DocumentTemplate<{ title: string; base?: string }> = {
  key: 'test-letter',
  prefix: 'TST',
  base: 'a4-plain',
  schema: z.object({ title: z.string().min(1), base: z.string().optional() }),
  build: (data) => ({ base: data.base, slots: { kind: 'plain', title: data.title }, body: { markdown: `# ${data.title}` } }),
};

/** Ein Ad-hoc-Auszug: wird gerendert und heruntergeladen, aber nie abgelegt. */
const excerpt: DocumentTemplate<{ title: string }> = {
  key: 'test-excerpt',
  prefix: 'AUS',
  base: 'a4-plain',
  filed: false,
  permission: 'audit.view',
  schema: z.object({ title: z.string().min(1) }),
  build: (data) => ({ slots: { kind: 'report', title: data.title }, body: { typst: `= ${data.title}` } }),
};

function setup() {
  const deps = createTestDeps({ coreTemplates: [letter, excerpt] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['documents.create', 'documents.view', 'audit.view'], userId), userId };
}

describe('documents service', () => {
  it('renders with a gapless number, stores the PDF in the Dokumente folder and freezes base + checksum', async () => {
    const { deps, ctx } = setup();
    const first = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Hallo' } }));
    const second = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Welt' }, entityType: 'user', entityId: 'U1' }));
    expect(first.number).toBe('TST-2026-001');
    expect(second.number).toBe('TST-2026-002');
    expect(second).toMatchObject({ status: 'issued', entityType: 'user', entityId: 'U1' });
    expect(second.inputSnapshot).toMatchObject({ input: { title: 'Welt' }, slots: { kind: 'plain', title: 'Welt' }, base: 'a4-plain', baseChecksum: 'a'.repeat(64) });

    const file = unwrap(await getDocument(deps, ctx, second.id));
    expect(new TextDecoder().decode(file.bytes)).toBe('%PDF-fake a4-plain Welt');
    expect(file.filename).toBe('TST-2026-002.pdf');
    expect(deps.db.select().from(mediaFolders).all().map((f) => f.path)).toEqual(['Dokumente']);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'documents.render')).toHaveLength(2);

    deps.clock.set('2027-01-02T09:00:00.000Z');
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'Neu' } })).number).toBe('TST-2027-001');
    expect(nextDocumentNumber(deps.db, 'TST', 2026)).toBe('TST-2026-003');
  });

  it('honours a build() base override and the documents.bases setting', async () => {
    const { deps, ctx } = setup();
    const viaBuild = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x', base: 'a4-mit-briefkopf' } }));
    expect(viaBuild.inputSnapshot).toMatchObject({ base: 'a4-mit-briefkopf' });

    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'documents.bases', value: { 'test-letter': 'a4-ohne-briefkopf' } }));
    const viaSetting = unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'y', base: 'a4-mit-briefkopf' } }));
    expect(viaSetting.inputSnapshot).toMatchObject({ base: 'a4-ohne-briefkopf' }); // Einstellung schlägt build() und Vorgabe
  });

  it('refuses when the base is unavailable', async () => {
    const { deps, ctx } = setup();
    const res = await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x', base: 'gibtsnicht' } });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'documentBaseUnavailable').toBe(true);
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

  it('lists the document bases with their probe result', async () => {
    const { deps, ctx } = setup();
    const bases = unwrap(await listDocumentBases(deps, ctx));
    expect(bases.map((b) => b.id)).toEqual(['a4-mit-briefkopf', 'a4-ohne-briefkopf', 'a4-plain']);
    expect(bases.every((b) => b.ok)).toBe(true);
    expect((await listDocumentBases(deps, ctxWith([]))).ok).toBe(false);
  });
  it('exports an ad-hoc excerpt without a number, a row or a stored file, but audits the export', async () => {
    const { deps, ctx } = setup();
    const out = unwrap(await exportDocument(deps, ctx, { templateKey: 'test-excerpt', input: { title: 'Protokoll' } }));
    expect(new TextDecoder().decode(out.bytes)).toBe('%PDF-fake a4-plain Protokoll');
    expect(out.filename).toBe('Protokoll.pdf');
    expect(out.mimeType).toBe('application/pdf');

    expect(unwrap(await listDocuments(deps, ctx, {})).total).toBe(0);
    expect(deps.db.select().from(mediaFolders).all()).toEqual([]);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'documents.export')).toHaveLength(1);

    // Der Nummernkreis bleibt unberührt: ein späterer Akteneintrag beginnt bei 001.
    expect(unwrap(await renderDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x' } })).number).toBe('TST-2026-001');
  });

  it('keeps exactly one path per kind: renderDocument refuses excerpts, exportDocument refuses filed templates', async () => {
    const { deps, ctx } = setup();
    const filed = await renderDocument(deps, ctx, { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(filed.ok === false && filed.error.type === 'conflict' && filed.error.code === 'documentNotFiled').toBe(true);
    const adHoc = await exportDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x' } });
    expect(adHoc.ok === false && adHoc.error.type === 'conflict' && adHoc.error.code === 'documentIsFiled').toBe(true);
  });

  it('requires documents.create and the extra template permission for an export', async () => {
    const { deps, userId } = setup();
    const noCreate = await exportDocument(deps, ctxWith(['audit.view'], userId), { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(noCreate.ok === false && noCreate.error.type === 'forbidden').toBe(true);
    const noExtra = await exportDocument(deps, ctxWith(['documents.create'], userId), { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(noExtra.ok === false && noExtra.error.type === 'forbidden').toBe(true);
    const bad = await exportDocument(deps, ctxWith(['documents.create', 'audit.view'], userId), { templateKey: 'test-excerpt', input: { title: '' } });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
  });
});
