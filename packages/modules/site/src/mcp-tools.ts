import { type Deps, type McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import { siteTemplateDir } from './env';
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  reorderEntries,
  setEntryPublished,
  updateEntry,
} from './entries';
import { schemaFor } from './field-schema';
import type { TemplateSchema } from './load';
import { activeTemplate, applyTemplateSync, previewTemplateSync, readActiveTemplate } from './service';
import { getVariables, setValues } from './values';

const tool = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({
  name,
  description,
  inputSchema,
  handler,
});

const fieldShape = (fields: TemplateSchema['collections'][string]['fields']) =>
  Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, schemaFor(field).optional()]));

function collectionTools(key: string, col: TemplateSchema['collections'][string]): McpToolDefinition[] {
  const shape = fieldShape(col.fields);
  const slug = col.slug ? { slug: z.string().optional() } : {};
  const tools: McpToolDefinition[] = [
    tool(`site_${key}_list`, `List the entries of the „${col.label}" collection. Requires site.view.`, z.object({}), (deps, ctx) => listEntries(deps, ctx, key)),
    tool(`site_${key}_get`, `Read one entry of „${col.label}". Requires site.view.`, z.object({ id: z.string() }), (deps, ctx, args) => getEntry(deps, ctx, (args as { id: string }).id)),
    tool(`site_${key}_create`, `Create an entry in „${col.label}" against its declared fields. Requires site.manage.`, z.object({ ...slug, ...shape }), (deps, ctx, args) => {
      const { slug: entrySlug, ...data } = args as Record<string, unknown>;
      return createEntry(deps, ctx, { collection: key, slug: entrySlug, data });
    }),
    tool(`site_${key}_update`, `Update an entry in „${col.label}". Requires site.manage.`, z.object({ id: z.string(), ...slug, ...shape }), (deps, ctx, args) => {
      const { id, slug: entrySlug, ...data } = args as Record<string, unknown> & { id: string };
      return updateEntry(deps, ctx, { id, slug: entrySlug, data });
    }),
    tool(`site_${key}_delete`, `Delete an entry in „${col.label}" (editorial content, audited). Requires site.manage.`, z.object({ id: z.string() }), (deps, ctx, args) => deleteEntry(deps, ctx, args)),
  ];
  if (col.publishable) {
    tools.push(
      tool(`site_${key}_set_published`, `Publish or withdraw an entry in „${col.label}". Requires site.manage.`, z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setEntryPublished(deps, ctx, args)),
    );
  }
  if (col.sortable) {
    tools.push(
      tool(`site_${key}_reorder`, `Set the order of entries in „${col.label}". Requires site.manage.`, z.object({ ids: z.array(z.string()) }), (deps, ctx, args) => reorderEntries(deps, ctx, { collection: key, ids: (args as { ids: string[] }).ids })),
    );
  }
  return tools;
}

const FIXED: McpToolDefinition[] = [
  tool(
    'site_template_read',
    'Read the active template declaration: name, locales, variables and collections. Requires site.view.',
    z.object({}),
    (deps, ctx) => readActiveTemplate(deps, ctx),
  ),
  tool(
    'site_template_sync',
    'Re-read the template file from the volume. Without confirm it returns the findings; with confirm it applies them. Requires site.manage.',
    z.object({ confirm: z.boolean().default(false) }),
    (deps, ctx, args) => {
      const dir = siteTemplateDir();
      return (args as { confirm: boolean }).confirm
        ? applyTemplateSync(deps, ctx, { dir, confirm: true })
        : previewTemplateSync(deps, ctx, dir);
    },
  ),
  tool('site_variables_get', 'Read all template variable values. Requires site.view.', z.object({}), (deps, ctx) => getVariables(deps, ctx)),
  tool('site_variables_set', 'Write template variable values, checked against the template schema. Requires site.manage.', z.object({ values: z.record(z.string(), z.unknown()) }), (deps, ctx, args) => setValues(deps, ctx, args)),
];

/** Die Werkzeuge des Moduls: feste plus je Sammlung des eingelesenen Templates. */
export const SITE_MCP_TOOLS = (deps: Deps): readonly McpToolDefinition[] => {
  const template = activeTemplate(deps);
  const perCollection = Object.entries(template?.schema.collections ?? {}).flatMap(([key, col]) => collectionTools(key, col));
  return [...FIXED, ...perCollection];
};
