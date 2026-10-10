import { expectedVersionField, type Deps, type McpToolDefinition } from '@kompass/core';
import { blockedTermsSchema, getBlockedTerms, setBlockedTerms } from './blocked-terms';
import { z } from 'zod';
import { siteTemplateDir } from './env';
import { siteContentHash } from './export';
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
import { getPublish, listPublishes } from './services/publishes';
import { siteJobResult } from './services/job-view';
import { sitePendingChanges } from './pending';
import { clearSiteCache, siteCacheStatus } from './pipeline/cache';
import { cancelSiteJob, SITE_JOB_KINDS, startDeployCheck, startPreview, startPublish } from './pipeline/jobs';


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

const jobDetailSchema = {
  paths: z.literal('all').optional().describe('Return every path instead of the first 20.'),
  log: z.literal('full').optional().describe('Return the whole log instead of its last 2000 characters.'),
};

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
  tool('site_variables_get', 'Read all template variable values and their version. Requires site.view.', z.object({}), (deps, ctx) => getVariables(deps, ctx), getVariables),
  tool('site_variables_set', 'Write template variable values, checked against the template schema. Requires site.manage. Localized fields are replaced as a whole map; to change one locale use translations_set. Pass expectedVersion (the version site_variables_get returned) to be rejected with staleVersion instead of overwriting a change made in between.', z.object({ values: z.record(z.string(), z.unknown()), expectedVersion: expectedVersionField }), (deps, ctx, args) => setValues(deps, ctx, args), setValues),
  tool('site_variables_options', 'List the selectable records per reference variable (value and label), filtered by the declared condition. Requires site.view.', z.object({}), (deps, ctx) => listReferenceOptions(deps, ctx), listReferenceOptions),
  tool('site_blocked_terms_get', 'Read the blocked terms: words that must never appear on the website; a hit blocks publishing. Requires site.view.', z.object({}), (deps, ctx) => getBlockedTerms(deps, ctx), getBlockedTerms),
  tool('site_blocked_terms_set', 'Replace the list of blocked terms (2–80 characters each, at most 50; blank lines and duplicates are dropped). Requires site.publish. Audited.', blockedTermsSchema, (deps, ctx, args) => setBlockedTerms(deps, ctx, args), setBlockedTerms),
  tool('site_export_check', 'Check the content without publishing: returns the contentHash of the current state (the one a preview reports), gaps, violations, stale and pendingReview: published records still waiting for a human review (a warning, not a block). Reads no original images and takes seconds. Requires site.publish.', z.object({}), async (deps, ctx) => {
    const result = await siteContentHash(deps, ctx);
    return result.ok ? { ok: true as const, value: { contentHash: result.value.contentHash, assets: result.value.assets, gaps: result.value.gaps, violations: result.value.violations, stale: result.value.stale, pendingReview: result.value.pendingReview } } : result;
  }, siteContentHash),
  tool(
    'site_pending_changes',
    'List the records whose public state (what the template receives: animals, projects, entries, variables, association data) changed since the last successful publish to production: kind changed|added|removed, label, href (the edit page; null for removed, the record may be gone) and recordHref (its address even when removed). count is the total, items are sorted by label and cut to limit (default 50), truncated says whether more exist. Internal fields, unpublished records and publishes on test do not count. since is the start of that publish; null means no publish with a recorded state yet, then count is 0. Changes nothing. Requires site.publish.',
    z.object({ limit: z.number().int().min(1).max(500).optional().describe('At most this many items (default 50); count stays the total.') }),
    (deps, ctx, args) => sitePendingChanges(deps, ctx, { limit: 50, ...(args as { limit?: number }) }),
    sitePendingChanges,
  ),
  // Check, Vorschau und Publish bauen die Seite und liefen über MCP in die
  // Zeitüberschreitung des Clients (01.10.). Sie starten nur; was dabei
  // herauskam, liest site_job_result — eine Abfrage für alle drei, weil Antwort
  // und Abfrageschleife dieselben sind.
  tool(
    'site_deploy_check',
    'Start the connection test of the deploy target in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Read the outcome with site_job_result (kind: deployCheck): passed and checks[] (connect, targetDir, writable, targetFiles) each with outcome ok|failed|skipped|notRun and, on failure, a problem (authFailed, unreachable, rsyncMissing, targetMissing, notWritable, diskFull, probeLeft, unknown), plus the files found at the target. The check logs in, lists the target directory, creates and removes a probe file (write access) and counts the files at the target. It builds and transfers nothing and takes seconds. A failed check point does not make the run fail: look at passed. Requires site.publish.',
    z.object({}),
    (deps, ctx) => startDeployCheck(deps, ctx, readSiteEnv(), { source: 'mcp' }),
    startDeployCheck,
  ),
  tool(
    'site_preview_build',
    'Start building the preview of the site in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Read the outcome with site_job_result (kind: preview): counts, the first paths of the diff against the last publish, gaps, violations, stale and pendingReview: published records still waiting for a human review (a warning, not a block), and the log tail; pass its contentHash to site_publish. Requires site.publish.',
    z.object({}),
    (deps, ctx) => startPreview(deps, ctx, readSiteEnv(), { source: 'mcp' }),
    startPreview,
  ),
  tool(
    'site_publish',
    'Start building and publishing the site to the configured deploy target in the background and return at once: { started: true, runId, startedAt }, or { started: false, running } while a preview, publish or check is already running. Requires site.publish, confirm: true and the expectedContentHash of the preview you reviewed (site_job_result, kind: preview); a missing target or confirmation fails right away. Read the outcome with site_job_result (kind: publish): status, counts, publishId or error, e.g. blockedTermsPresent or previewOutdated. Every attempt also appears in site_publishes. Audited.',
    z.object({ confirm: z.boolean(), expectedContentHash: z.string().min(1).describe('contentHash of the preview you reviewed (site_job_result kind preview); a different current state is refused with previewOutdated') }),
    (deps, ctx, args) => startPublish(deps, ctx, readSiteEnv(), { ...(args as { confirm: boolean; expectedContentHash: string }), source: 'mcp' }),
    startPublish,
  ),
  tool(
    'site_job_result',
    'Read the state of the background site jobs for one kind (deployCheck, preview, publish): running (the job in progress of any kind, with its steps, counters, source, elapsedMs and cancellable) and last (the last finished run of this kind: status success|failed|aborted|interrupted, reason, timeout {limitMs, stalled} and stoppedAt {done, total} after a timeout, failure for a failed publish, passed and checks for deployCheck, counts, the first 20 paths of each list with total and truncated, all blocked-term hits, skipped images, the last 2000 log characters). paths: "all" and log: "full" return everything. Poll every few seconds until last.runId is the runId the start returned. Changes nothing. Requires site.publish.',
    z.object({ kind: z.enum(SITE_JOB_KINDS), ...jobDetailSchema }),
    async (deps, ctx, args) => siteJobResult(deps, ctx, readSiteEnv(), args),
    siteJobResult,
  ),
  // Wer veröffentlichen darf, soll nachsehen können, ob und wann zuletzt
  // veröffentlicht wurde (Prinzip 8) — ein reiner Lesezugriff.
  tool(
    'site_publishes',
    'List the publish history, newest first (environment defaults to this installation): when, by whom and from where (source: channel ui, mcp or system, plus the API token name), with what result and how many pages changed, without file lists or logs; use site_publish_get for those. Requires site.view.',
    z.object({ environment: z.string().min(1).optional(), limit: z.number().int().min(1).max(200).optional() }),
    (deps, ctx, args) => listPublishes(deps, ctx, args as { environment?: string; limit?: number }),
    listPublishes,
  ),
  tool(
    'site_job_cancel',
    'Cancel the running site job with this runId. A publish cannot be cancelled once the transfer has begun (jobNotCancellable); another or no running job gives jobNotRunning. The run ends with status aborted, reason cancelled. Requires site.publish. Audited.',
    z.object({ runId: z.string().min(1) }),
    async (deps, ctx, args) => cancelSiteJob(deps, ctx, readSiteEnv(), args),
    cancelSiteJob,
  ),
  tool(
    'site_publish_get',
    'Read one publish of the history by id: summary, the first 20 transferred files (paths: "all" for every one) and the last 2000 log characters (log: "full" for the whole log). Requires site.view.',
    z.object({ id: z.string().min(1), ...jobDetailSchema }),
    (deps, ctx, args) => getPublish(deps, ctx, args as { id: string; paths?: 'all'; log?: 'full' }),
    getPublish,
  ),
  tool(
    'site_cache_status',
    'Show the build cache of the website: number, size and age of the image variants, size and build time of the preview. Changes nothing. Requires site.manage.',
    z.object({}),
    async (deps, ctx) => siteCacheStatus(deps, ctx, readSiteEnv()),
    siteCacheStatus,
  ),
  tool(
    'site_cache_clear',
    'Delete the image variants and the preview so the next build creates them anew (slow for many photos). Refused with siteJobRunning while a preview, check or publish runs. Requires site.manage. Audited.',
    z.object({}),
    async (deps, ctx) => clearSiteCache(deps, ctx, readSiteEnv()),
    clearSiteCache,
  ),
];

/** Die Werkzeuge des Moduls: feste plus je Sammlung des eingelesenen Templates. */
export const SITE_MCP_TOOLS = (deps: Deps): readonly McpToolDefinition[] => {
  const template = activeTemplate(deps);
  const perCollection = Object.entries(template?.schema.collections ?? {}).flatMap(([key, col]) => collectionTools(key, col));
  return [...FIXED, ...perCollection];
};
