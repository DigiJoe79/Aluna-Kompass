import {
  type CallContext,
  type Deps,
  type Result,
  conflict,
  invalid,
  isoNow,
  ok,
  recordAudit,
  requirePermission,
} from '@kompass/core';
import { z } from 'zod';
import { ensureModuleResolution, loadTemplate, type TemplateSchema } from './load';
import { applyFindings } from './resync/apply';
import { type Finding, type ResyncData, planResync } from './resync/plan';
import { siteEntries, siteTemplateState, siteValues } from './schema';

const STATE_ID = 'current';
const EMPTY_SCHEMA: TemplateSchema = { name: '', locales: [], uses: [], variables: {}, collections: {} };

const applyInput = z.object({ dir: z.string().min(1), confirm: z.boolean() });

export interface StoredTemplate {
  name: string;
  schema: TemplateSchema;
  checksum: string;
}

export interface SyncPreview {
  name: string;
  findings: Finding[];
  blocking: Finding[];
  localesMissing: string[];
  checksum: string;
}

function readTemplateState(deps: Deps): StoredTemplate | undefined {
  const row = deps.db.select().from(siteTemplateState).get();
  if (!row) return undefined;
  return { name: row.name, schema: row.schemaJson as TemplateSchema, checksum: row.checksum };
}

/** Der zuletzt eingelesene Template-Stand oder `null`, wenn noch keiner gelesen wurde. */
export function activeTemplate(deps: Deps): StoredTemplate | null {
  return readTemplateState(deps) ?? null;
}

/** Die vorhandenen Inhalte in der Form, die `planResync` vergleicht. */
function readAllData(deps: Deps): ResyncData {
  const variables: Record<string, unknown> = {};
  for (const row of deps.db.select().from(siteValues).all()) variables[row.key] = row.value;
  const collections: Record<string, Array<Record<string, unknown>>> = {};
  for (const row of deps.db.select().from(siteEntries).all()) {
    (collections[row.collection] ??= []).push((row.data as Record<string, unknown>) ?? {});
  }
  return { variables, collections };
}

function buildPreview(deps: Deps, schema: TemplateSchema, definitionLocales: string[], checksum: string, name: string): SyncPreview {
  const localesMissing = definitionLocales.filter((l) => !deps.locales().includes(l));
  const previous = readTemplateState(deps);
  const findings = planResync(previous?.schema ?? EMPTY_SCHEMA, schema, readAllData(deps));
  return {
    name,
    findings,
    blocking: findings.filter((f) => f.kind === 'overLimit'),
    localesMissing,
    checksum,
  };
}

export async function previewTemplateSync(deps: Deps, ctx: CallContext, dir: string): Promise<Result<SyncPreview>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  await ensureModuleResolution(dir);
  const loaded = await loadTemplate(dir);
  if (!loaded.ok) return loaded;
  return ok(buildPreview(deps, loaded.value.schema, loaded.value.definition.locales, loaded.value.checksum, loaded.value.definition.name));
}

export async function applyTemplateSync(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SyncPreview>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const parsed = applyInput.safeParse(input);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  const { dir, confirm } = parsed.data;

  await ensureModuleResolution(dir);
  const loaded = await loadTemplate(dir);
  if (!loaded.ok) return loaded;

  const preview = buildPreview(deps, loaded.value.schema, loaded.value.definition.locales, loaded.value.checksum, loaded.value.definition.name);

  if (preview.localesMissing.length > 0) {
    return conflict('localeMissing', `Das Template fordert Sprachen, die nicht eingerichtet sind: ${preview.localesMissing.join(', ')}`);
  }
  if (preview.blocking.length > 0) {
    const names = preview.blocking.map((f) => f.path).join(', ');
    return conflict('overLimit', `Erst aufräumen: ${names} überschreitet die neue Obergrenze`);
  }
  if (!confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);

  const before = readTemplateState(deps);
  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    applyFindings(tx, deps, preview.findings, loaded.value.schema);
    tx.insert(siteTemplateState)
      .values({
        id: STATE_ID,
        name: loaded.value.definition.name,
        schemaJson: loaded.value.schema,
        checksum: loaded.value.checksum,
        readAt: now,
        readByUserId: ctx.userId,
      })
      .onConflictDoUpdate({
        target: siteTemplateState.id,
        set: {
          name: loaded.value.definition.name,
          schemaJson: loaded.value.schema,
          checksum: loaded.value.checksum,
          readAt: now,
          readByUserId: ctx.userId,
        },
      })
      .run();
    recordAudit(tx, deps, ctx, {
      action: 'site.template.read',
      entityType: 'siteTemplate',
      entityId: STATE_ID,
      before: before ? { name: before.name, checksum: before.checksum } : null,
      after: { name: loaded.value.definition.name, checksum: loaded.value.checksum, findings: preview.findings },
      summary: `Template „${loaded.value.definition.name}" eingelesen`,
    });
  });

  return ok(preview);
}

/** Grundlage der Publish-Sicherung: stimmt die Datei mit dem gelesenen Stand überein? */
export async function templateIsCurrent(deps: Deps, dir: string): Promise<boolean> {
  const state = readTemplateState(deps);
  if (!state) return false;
  const loaded = await loadTemplate(dir);
  return loaded.ok && loaded.value.checksum === state.checksum;
}
