import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, defineModule, definePublishedView, moduleMcpTools, setModuleEnabled, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, text } from '@kompass/site-template';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { lastSiteJob, startDeployCheck, startPreview, startPublish } from '../src/pipeline/jobs';
import { siteTemplateState } from '../src/schema';
import { listPublishes } from '../src/services/publishes';
import { listReferenceOptions } from '../src/values';
import { getBlockedTerms, setBlockedTerms } from '../src/blocked-terms';
import { applyTemplateSync } from '../src/service';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

const notes: TemplateSchema['collections'][string] = {
  label: 'Notizen',
  slug: false,
  sortable: false,
  publishable: false,
  fields: { body: asJson(text({ label: 'Text' })) },
};
const articles: TemplateSchema['collections'][string] = {
  label: 'Artikel',
  slug: true,
  sortable: false,
  publishable: true,
  fields: { title: asJson(text({ localized: true, label: 'Titel' })), cover: asJson(asset({ label: 'Bild' })) },
};

const withTemplate = (collections: TemplateSchema['collections']) => {
  const deps = createTestDeps({ locales: ['de'] });
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
  return deps;
};

const jsonSchema = (tool: { inputSchema: z.ZodType<unknown> }) =>
  z.toJSONSchema(tool.inputSchema, { io: 'input' }) as { properties?: Record<string, unknown> };

describe('site mcp tools', () => {
  it('offers the fixed tools even without a template', () => {
    const names = moduleMcpTools(createTestDeps(), siteModule).map((t) => t.name);
    expect(names).toEqual([
      'site_template_read',
      'site_template_sync',
      'site_variables_get',
      'site_variables_set',
      'site_variables_options',
      'site_blocked_terms_get',
      'site_blocked_terms_set',
      'site_export_check',
      'site_deploy_check',
      'site_preview_build',
      'site_publish',
      'site_job_result',
      'site_publishes',
    ]);
  });

  it('pflegt die Sperrwörter mit site.publish (Backlog 23)', () => {
    const tools = Object.fromEntries(moduleMcpTools(createTestDeps(), siteModule).map((t) => [t.name, t]));
    expect(tools.site_blocked_terms_set?.service).toBe(setBlockedTerms);
    expect(tools.site_blocked_terms_set?.description).toContain('site.publish');
    expect(tools.site_blocked_terms_get?.service).toBe(getBlockedTerms);
    expect(Object.keys(jsonSchema(tools.site_blocked_terms_set!).properties ?? {})).toEqual(['terms']);
  });

  it('lässt den Verlauf lesen und nennt dafür seinen Service', () => {
    const tool = moduleMcpTools(createTestDeps(), siteModule).find((t) => t.name === 'site_publishes')!;
    expect(tool.service).toBe(listPublishes);
    expect(tool.description).toContain('site.view');
    expect(Object.keys(jsonSchema(tool).properties ?? {})).toEqual(expect.arrayContaining(['environment', 'limit']));
  });

  it('adds six tools per collection, seven where it is publishable', () => {
    const tools = moduleMcpTools(withTemplate({ notes, articles }), siteModule).map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(['site_notes_list', 'site_notes_get', 'site_notes_create', 'site_notes_update', 'site_notes_delete', 'site_notes_deletion_preview']),
    );
    expect(tools).not.toContain('site_notes_set_published');
    expect(tools).toContain('site_articles_set_published');
    expect(tools.filter((n) => n.startsWith('site_notes_'))).toHaveLength(6);
    expect(tools.filter((n) => n.startsWith('site_articles_'))).toHaveLength(7);
  });

  it('names the fields of a collection in its create schema', () => {
    const tools = moduleMcpTools(withTemplate({ articles }), siteModule);
    const create = tools.find((t) => t.name === 'site_articles_create')!;
    const props = Object.keys(jsonSchema(create).properties ?? {});
    expect(props).toEqual(expect.arrayContaining(['slug', 'title', 'cover']));
  });

  it('describes every tool with the permission it needs', () => {
    const tools = moduleMcpTools(withTemplate({ notes, articles }), siteModule);
    for (const t of tools) {
      expect(t.description).toMatch(/site\.(view|manage|publish)/);
    }
  });

  it('describes the deploy check as two separate statements, not a removal list', () => {
    const tools = Object.fromEntries(moduleMcpTools(createTestDeps(), siteModule).map((t) => [t.name, t]));
    const description = tools.site_deploy_check?.description ?? '';
    expect(description).toContain('site.publish');
    expect(description).toMatch(/found there|path check/i);
    expect(description).toMatch(/would (change|transfer)/i);
  });

  it('starts check, preview and publish in the background and reads all three with one tool', () => {
    const tools = Object.fromEntries(moduleMcpTools(createTestDeps(), siteModule).map((t) => [t.name, t]));
    expect(tools.site_deploy_check?.service).toBe(startDeployCheck);
    expect(tools.site_preview_build?.service).toBe(startPreview);
    expect(tools.site_publish?.service).toBe(startPublish);
    for (const name of ['site_deploy_check', 'site_preview_build', 'site_publish']) {
      expect(tools[name]?.description).toContain('site_job_result');
    }
    expect(tools.site_job_result?.service).toBe(lastSiteJob);
    expect(tools.site_job_result?.description).toContain('site.publish');
    expect(jsonSchema(tools.site_job_result!).properties?.kind).toMatchObject({ enum: ['preview', 'publish', 'deployCheck'] });
  });

  it('site_variables_options calls listReferenceOptions', () => {
    const deps = withTemplate({});
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    expect(tools.site_variables_options?.service).toBe(listReferenceOptions);
    expect(tools.site_variables_options?.description).toContain('site.view');
  });

  it('reicht beim Ändern eines Eintrags den Ladestand durch, statt ihn als Feld zu speichern (Backlog 20)', async () => {
    const deps = withTemplate({ notes });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['site.manage', 'site.view']);
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    expect(jsonSchema(tools.site_notes_update!).properties).toHaveProperty('expectedVersion');

    const created = (await tools.site_notes_create!.handler(deps, ctx, { body: 'Eins' })) as { ok: true; value: { id: string; updatedAt: string } };
    deps.clock.advance(60_000);
    await tools.site_notes_update!.handler(deps, ctx, { id: created.value.id, body: 'Zwei' });

    const stale = await tools.site_notes_update!.handler(deps, ctx, { id: created.value.id, body: 'Drei', expectedVersion: created.value.updatedAt });
    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
  });

  /**
   * Ein Update nennt nur, was sich ändert. Asset-Felder tragen im Feldschema
   * `.default(null)`, und Zod 4 wendet das auch hinter `.optional()` an: Ein
   * `site_…_update` ohne das Bild löschte es (Hinweis des Test-Agenten,
   * 2026-09-19). Dasselbe darf mit keinem Feld passieren, das fehlt.
   */
  it('lässt beim Update Felder stehen, die der Aufruf nicht nennt', async () => {
    const deps = withTemplate({ articles });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['site.manage', 'site.view', 'media.upload']);
    const photo = (await storeMediaAsset(deps, ctx, { originalName: 'bild.png', bytes: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')) })) as { ok: true; value: { id: string } };
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    const created = (await tools.site_articles_create!.handler(deps, ctx, { slug: 'a', title: { de: 'Titel' }, cover: photo.value.id })) as { ok: true; value: { id: string } };
    expect(created.ok).toBe(true);

    const updated = (await tools.site_articles_update!.handler(deps, ctx, tools.site_articles_update!.inputSchema.parse({ id: created.value.id, title: { de: 'Neuer Titel' } }))) as { ok: true; value: { data: Record<string, unknown> } };

    expect(updated.ok).toBe(true);
    expect(updated.value.data.cover).toBe(photo.value.id);
    expect(jsonSchema(tools.site_articles_update!).properties?.cover).not.toHaveProperty('default');
  });
});

describe('site_export_check', () => {
  it('reports published records that still wait for a human review', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-mcp-tpl-'));
    const before = process.env.SITE_TEMPLATE_DIR;
    process.env.SITE_TEMPLATE_DIR = dir;
    try {
      writeFileSync(
        path.join(dir, 'kompass.template.ts'),
        "import { defineTemplate, text } from '@kompass/site-template';\nexport default defineTemplate({ name: 'X', locales: ['de'], variables: { claim: text({ label: 'Claim' }) }, collections: {} });",
      );
      const waiting = defineModule({
        key: 'waiting',
        version: '0',
        permissions: [],
        publishedViews: [definePublishedView({ name: 'things', schema: z.object({ slug: z.string() }), load: () => [], pendingReview: () => [{ label: 'Ding', href: '/things/1' }] })],
      });
      const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, waiting, siteModule] });
      insertUser(deps, { id: 'USER-TEST' });
      unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'waiting', enabled: true }));
      unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
      const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
      const result = await tools.site_export_check!.handler(deps, ctxWith(['site.publish']), {});
      expect(result).toMatchObject({ ok: true, value: { pendingReview: [{ view: 'things', label: 'Ding', href: '/things/1' }] } });
      expect(tools.site_export_check!.description).toContain('pendingReview');
      expect(tools.site_preview_build!.description).toContain('pendingReview');
    } finally {
      if (before === undefined) delete process.env.SITE_TEMPLATE_DIR;
      else process.env.SITE_TEMPLATE_DIR = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
