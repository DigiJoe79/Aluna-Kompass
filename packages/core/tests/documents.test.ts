import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLog, mediaFolders } from '../src/db/schema';
import { exportDocument, listDocumentBases } from '../src/documents/service';
import type { DocumentTemplate } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const letter: DocumentTemplate<{ title: string; base?: string }> = {
  key: 'test-letter',
  type: 'letter',
  base: 'a4-plain',
  schema: z.object({ title: z.string().min(1), base: z.string().optional() }),
  build: (data) => ({ base: data.base, slots: { kind: 'plain', title: data.title }, body: { markdown: `# ${data.title}` } }),
};

/** Ein Ad-hoc-Auszug: wird gerendert und heruntergeladen, aber nie abgelegt. */
const excerpt: DocumentTemplate<{ title: string }> = {
  key: 'test-excerpt',
  type: 'excerpt',
  base: 'a4-plain',
  filed: false,
  permission: 'audit.view',
  schema: z.object({ title: z.string().min(1) }),
  build: (data) => ({ slots: { kind: 'report', title: data.title }, body: { typst: `= ${data.title}` } }),
};

function setup() {
  const deps = createTestDeps({ coreTemplates: [letter, excerpt] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['documents.export', 'audit.view'], userId), userId };
}

describe('documents service', () => {
  it('honours a build() base override and the documents.bases setting', async () => {
    const { deps, ctx } = setup();
    const viaBuild = unwrap(await exportDocument(deps, ctx, { templateKey: 'test-excerpt', input: { title: 'x' } }));
    expect(new TextDecoder().decode(viaBuild.bytes)).toBe('%PDF-fake a4-plain x');
  });

  it('refuses when the base is unavailable', async () => {
    const { deps, ctx } = setup();
    const excerptWithBase: DocumentTemplate<{ title: string; base?: string }> = {
      ...excerpt,
      key: 'test-excerpt-base',
      schema: z.object({ title: z.string().min(1), base: z.string().optional() }),
      build: (data) => ({ base: data.base, slots: { kind: 'report', title: data.title }, body: { typst: `= ${data.title}` } }),
    };
    const deps2 = createTestDeps({ coreTemplates: [letter, excerptWithBase] });
    const userId = insertUser(deps2, {});
    const ctx2 = ctxWith(['documents.export', 'audit.view'], userId);
    const res = await exportDocument(deps2, ctx2, { templateKey: 'test-excerpt-base', input: { title: 'x', base: 'gibtsnicht' } });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'documentBaseUnavailable').toBe(true);
  });

  it('validates input against the template schema and requires the permission', async () => {
    const { deps, ctx } = setup();
    const bad = await exportDocument(deps, ctx, { templateKey: 'test-excerpt', input: { title: '' } });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.path === 'title').toBe(true);
    const unknown = await exportDocument(deps, ctx, { templateKey: 'nope', input: {} });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const denied = await exportDocument(deps, ctxWith(['audit.view']), { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
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

    expect(deps.db.select().from(mediaFolders).all()).toEqual([]);
    expect(deps.db.select().from(auditLog).all().filter((e) => e.action === 'documents.export')).toHaveLength(1);
  });

  it('exportDocument refuses filed templates', async () => {
    const { deps, ctx } = setup();
    const adHoc = await exportDocument(deps, ctx, { templateKey: 'test-letter', input: { title: 'x' } });
    expect(adHoc.ok === false && adHoc.error.type === 'conflict' && adHoc.error.code === 'documentIsFiled').toBe(true);
  });

  it('requires documents.export and the extra template permission for an export', async () => {
    const { deps, userId } = setup();
    const noExport = await exportDocument(deps, ctxWith([], userId), { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(noExport.ok === false && noExport.error.type === 'forbidden').toBe(true);
    const noExtra = await exportDocument(deps, ctxWith(['documents.export'], userId), { templateKey: 'test-excerpt', input: { title: 'x' } });
    expect(noExtra.ok === false && noExtra.error.type === 'forbidden').toBe(true);
    const bad = await exportDocument(deps, ctxWith(['documents.export', 'audit.view'], userId), { templateKey: 'test-excerpt', input: { title: '' } });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
  });
});
