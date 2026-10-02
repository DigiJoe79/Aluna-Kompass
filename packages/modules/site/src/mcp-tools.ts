import { expectedVersionField, type Deps, type McpToolDefinition } from '@kompass/core';
import { blockedTermsSchema, getBlockedTerms, setBlockedTerms } from './blocked-terms';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { siteTemplateDir } from './env';
import { exportSiteContent } from './export';
import {
  createEntry,
  deleteEntry,
  entryDeletionPreview,
  getEntry,
  listEntries,
  reorderEntries,
  setEntryPublished,
  updateEntry,
} from './entries';
import { schemaFor } from './field-schema';
import type { TemplateSchema } from './load';
import { activeTemplate, applyTemplateSync, previewTemplateSync, readActiveTemplate } from './service';
import { getVariables, listReferenceOptions, setValues } from './values';
import { readSiteEnv } from './pipeline/env';
import { listPublishes } from './services/publishes';
import { lastSiteJob, SITE_JOB_KINDS, startDeployCheck, startPreview, startPublish } from './pipeline/jobs';


const tool = (
  name: string,
  description: string,
  inputSchema: z.ZodType<unknown>,
  handler: McpToolDefinition['handler'],
  service: McpToolDefinition['service'],
): McpToolDefinition => ({
  name,
  description,
  inputSchema,
  handler,
  service,
});

const fieldShape = (fields: TemplateSchema['collections'][string]['fields']) =>
  Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, schemaFor(field).optional()]));

/**
 * Beim Update ohne Vorgabewerte: Ein Asset-Feld trägt `.default(null)`, und Zod
 * 4 wendet das auch hinter `.optional()` an. Ein Update, das das Feld nicht
 * nannte, schrieb deshalb `null` und löschte Bild oder Datei (2026-09-19). Ein
 * Update nennt nur, was sich ändert — was fehlt, bleibt.
 */
const withoutDefault = (schema: z.ZodType): z.ZodType => (schema instanceof z.ZodDefault ? (schema.removeDefault() as z.ZodType) : schema);
const updateShape = (fields: TemplateSchema['collections'][string]['fields']) =>
  Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, withoutDefault(schemaFor(field)).optional()]));

function collectionTools(key: string, col: TemplateSchema['collections'][string]): McpToolDefinition[] {
  const shape = fieldShape(col.fields);
  const slug = col.slug ? { slug: z.string().optional() } : {};
  const tools: McpToolDefinition[] = [
    tool(`site_${key}_list`, `List the entries of the „${col.label}“ collection. Requires site.view.`, z.object({}), (deps, ctx) => listEntries(deps, ctx, key), listEntries),
    tool(`site_${key}_get`, `Read one entry of „${col.label}“. Requires site.view.`, z.object({ id: z.string() }), (deps, ctx, args) => getEntry(deps, ctx, (args as { id: string }).id), getEntry),
    tool(`site_${key}_create`, `Create an entry in „${col.label}“ against its declared fields. Requires site.manage.`, z.object({ ...slug, ...shape }), (deps, ctx, args) => {
      const { slug: entrySlug, ...data } = args as Record<string, unknown>;
      return createEntry(deps, ctx, { collection: key, slug: entrySlug, data });
    }, createEntry),
    tool(`site_${key}_update`, `Update an entry in „${col.label}“. Requires site.manage. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the updatedAt you last read) to be rejected with staleVersion instead of overwriting a change made in between.`, z.object({ id: z.string(), ...slug, ...updateShape(col.fields), expectedVersion: expectedVersionField }), (deps, ctx, args) => {
      const { id, slug: entrySlug, expectedVersion, ...data } = args as Record<string, unknown> & { id: string; expectedVersion?: string };
      return updateEntry(deps, ctx, { id, slug: entrySlug, data, expectedVersion });
    }, updateEntry),
    tool(`site_${key}_deletion_preview`, `Tell whether an entry in „${col.label}“ can be deleted: still published, still referenced, and which media are used nowhere else. Call this before site_${key}_delete. Requires site.view.`, z.object({ id: z.string() }), (deps, ctx, args) => entryDeletionPreview(deps, ctx, (args as { id: string }).id), entryDeletionPreview),
    tool(`site_${key}_delete`, `Delete an entry in „${col.label}“ (editorial content, audited). Two steps: a published entry must be withdrawn first. deleteOrphanedMedia also deletes media used nowhere else and needs media.upload. Requires site.manage.`, z.object({ id: z.string(), deleteOrphanedMedia: z.boolean().optional() }), (deps, ctx, args) => deleteEntry(deps, ctx, args), deleteEntry),
  ];
  if (col.publishable) {
    tools.push(
      tool(`site_${key}_set_published`, `Publish or withdraw an entry in „${col.label}“. Requires site.manage.`, z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setEntryPublished(deps, ctx, args), setEntryPublished),
    );
  }
  if (col.sortable) {
    tools.push(
      tool(`site_${key}_reorder`, `Set the order of entries in „${col.label}“. Requires site.manage.`, z.object({ ids: z.array(z.string()) }), (deps, ctx, args) => reorderEntries(deps, ctx, { collection: key, ids: (args as { ids: string[] }).ids }), reorderEntries),
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
    readActiveTemplate,
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
    applyTemplateSync,
  ),
  tool('site_variables_get', 'Read all template variable values. Requires site.view.', z.object({}), (deps, ctx) => getVariables(deps, ctx), getVariables),
  tool('site_variables_set', 'Write template variable values, checked against the template schema. Requires site.manage. Localized fields are replaced as a whole map; to change one locale use translations_set.', z.object({ values: z.record(z.string(), z.unknown()) }), (deps, ctx, args) => setValues(deps, ctx, args), setValues),
  tool('site_variables_options', 'List the selectable records per reference variable (value and label), filtered by the declared condition. Requires site.view.', z.object({}), (deps, ctx) => listReferenceOptions(deps, ctx), listReferenceOptions),
  tool('site_blocked_terms_get', 'Read the blocked terms: words that must never appear on the website; a hit blocks publishing. Requires site.view.', z.object({}), (deps, ctx) => getBlockedTerms(deps, ctx), getBlockedTerms),
  tool('site_blocked_terms_set', 'Replace the list of blocked terms (2–80 characters each, at most 50; blank lines and duplicates are dropped). Requires site.publish. Audited.', blockedTermsSchema, (deps, ctx, args) => setBlockedTerms(deps, ctx, args), setBlockedTerms),
  tool('site_export_check', 'Build the content export into a throwaway directory without publishing, to check it is current and complete. Returns gaps, violations, stale and pendingReview: published records still waiting for a human review (a warning, not a block). Requires site.publish.', z.object({}), async (deps, ctx) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kompass-site-check-'));
    try {
      const result = await exportSiteContent(deps, ctx, { jobDir: dir });
      return result.ok ? { ok: true as const, value: { contentHash: result.value.contentHash, assets: result.value.assets.length, gaps: result.value.gaps, violations: result.value.violations, stale: result.value.stale, pendingReview: result.value.pendingReview } } : result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, exportSiteContent),
  // Check, Vorschau und Publish bauen die Seite und liefen über MCP in die
  // Zeitüberschreitung des Clients (01.10.). Sie starten nur; was dabei
  // herauskam, liest site_job_result — eine Abfrage für alle drei, weil Antwort
  // und Abfrageschleife dieselben sind.
  tool(
    'site_deploy_check',
    'Start the deploy target check in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Read the outcome with site_job_result (kind: deployCheck). The check transfers nothing: it lists the files found there (path check) and, from a fresh build like site_publish would transfer, what a publish would change, add and remove. Requires site.publish.',
    z.object({}),
    (deps, ctx) => startDeployCheck(deps, ctx, readSiteEnv()),
    startDeployCheck,
  ),
  tool(
    'site_preview_build',
    'Start building the preview of the site in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Read the outcome with site_job_result (kind: preview): diff against the last publish, gaps, violations, stale and pendingReview: published records still waiting for a human review (a warning, not a block), previewDir and log. Requires site.publish.',
    z.object({}),
    (deps, ctx) => startPreview(deps, ctx, readSiteEnv()),
    startPreview,
  ),
  tool(
    'site_publish',
    'Start building and publishing the site to the configured deploy target in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Requires site.publish and confirm: true; a missing target or confirmation fails right away. Read the outcome with site_job_result (kind: publish): result { status, record, diff, log } or error, e.g. blockedTermsPresent. Every attempt also appears in site_publishes. Audited.',
    z.object({ confirm: z.boolean() }),
    (deps, ctx, args) => startPublish(deps, ctx, readSiteEnv(), args as { confirm: boolean }),
    startPublish,
  ),
  tool(
    'site_job_result',
    'Read the state of the background site jobs started by site_deploy_check, site_preview_build and site_publish, for one kind (deployCheck, preview, publish): running (the job in progress, if any, of any kind — only one runs at a time) and last (the last finished run of this kind: runId, startedAt, finishedAt, userId and either result or error). Poll every few seconds until last.runId is the runId the start returned. Changes nothing. Requires site.publish.',
    z.object({ kind: z.enum(SITE_JOB_KINDS) }),
    async (deps, ctx, args) => lastSiteJob(deps, ctx, readSiteEnv(), args),
    lastSiteJob,
  ),
  // Wer veröffentlichen darf, soll nachsehen können, ob und wann zuletzt
  // veröffentlicht wurde (Prinzip 8) — ein reiner Lesezugriff.
  tool(
    'site_publishes',
    'List the publish history of an environment, newest first: when, by whom, with what result and how many pages changed. Requires site.view.',
    z.object({ environment: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }),
    (deps, ctx, args) => listPublishes(deps, ctx, args as { environment: string; limit?: number }),
    listPublishes,
  ),
];

/** Die Werkzeuge des Moduls: feste plus je Sammlung des eingelesenen Templates. */
export const SITE_MCP_TOOLS = (deps: Deps): readonly McpToolDefinition[] => {
  const template = activeTemplate(deps);
  const perCollection = Object.entries(template?.schema.collections ?? {}).flatMap(([key, col]) => collectionTools(key, col));
  return [...FIXED, ...perCollection];
};
