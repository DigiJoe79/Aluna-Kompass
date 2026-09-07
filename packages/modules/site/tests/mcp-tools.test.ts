import { moduleMcpTools } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, text } from '@kompass/site-template';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { siteTemplateState } from '../src/schema';

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
    expect(names).toEqual(['site_template_read', 'site_template_sync', 'site_variables_get', 'site_variables_set']);
  });

  it('adds five tools per collection, six where it is publishable', () => {
    const tools = moduleMcpTools(withTemplate({ notes, articles }), siteModule).map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(['site_notes_list', 'site_notes_get', 'site_notes_create', 'site_notes_update', 'site_notes_delete']),
    );
    expect(tools).not.toContain('site_notes_set_published');
    expect(tools).toContain('site_articles_set_published');
    expect(tools.filter((n) => n.startsWith('site_notes_'))).toHaveLength(5);
    expect(tools.filter((n) => n.startsWith('site_articles_'))).toHaveLength(6);
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
      expect(t.description).toMatch(/site\.(view|manage)/);
    }
  });
});
