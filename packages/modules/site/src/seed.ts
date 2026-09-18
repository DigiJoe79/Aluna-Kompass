import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type CallContext,
  type Deps,
  type Result,
  conflict,
  invalid,
  isoNow,
  newId,
  ok,
  parseFolderPath,
  readSetting,
  recordAudit,
  requirePermission,
  schema as core,
  storeMediaInternal,
  validate,
  writeSettingInternal,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { siteTemplateDir } from './env';
import { schemaFor, widgetOf } from './field-schema';
import { siteEntries, siteValues } from './schema';
import { activeTemplate } from './service';
import type { FieldSchema, TemplateSchema } from './load';
import type { SeedReport } from './types';

export type { SeedReport } from './types';

export interface SeedAsset {
  id: string;
  filename: string;
  mimeType: string;
}

export interface SeedDocument {
  variables: Record<string, unknown>;
  collections: Record<string, Array<Record<string, unknown>>>;
  assets: SeedAsset[];
  /** Mediathek-Ordner, in den die Seed-Dateien wandern. Vorgabe „Webseite“. */
  folder?: string;
}

/** Ordner, in den die Startinhalte ihre Dateien legen, wenn `seed/content.json` keinen nennt. */
export const DEFAULT_SEED_MEDIA_FOLDER = 'Webseite';

/** Das Verzeichnis mit der Seed-Fixette, neben `kompass.template.ts`. */
export const seedDir = (templateDir: string): string => path.join(templateDir, 'seed');

const documentSchema = z.object({
  variables: z.record(z.string(), z.unknown()).default({}),
  collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  assets: z
    .array(z.object({ id: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1) }))
    .default([]),
  folder: z.string().min(1).optional(),
});

/**
 * Liest `<templateDir>/seed/content.json`. Die Datei hat die Form des
 * Kompass-Exports; gelesen werden `variables`, `collections` und `assets`,
 * ein mitgeführtes `views` wird ignoriert.
 */
export async function readSeed(templateDir: string): Promise<Result<SeedDocument>> {
  const file = path.join(seedDir(templateDir), 'content.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return conflict('noSeed', 'Das Template bringt keine Startinhalte mit (seed/content.json fehlt)');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid([{ path: 'seed/content.json', message: 'invalidJson' }]);
  }
  const parsed = documentSchema.safeParse(json);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  return ok(parsed.data);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Feldnamen, unter denen ein Asset steht — dieselbe Markierung wie im Export. */
const assetFieldKeys = (fields: Record<string, FieldSchema>): string[] =>
  Object.entries(fields)
    .filter(([, f]) => widgetOf(f) === 'asset')
    .map(([k]) => k);

/**
 * Übernimmt die Startinhalte des Templates in eine leere Webseite. Einmalig:
 * `site.seedAppliedAt` sperrt weitere Läufe, die Leerprüfung schützt zusätzlich.
 */
export async function applySeed(deps: Deps, ctx: CallContext, opts: { confirm: boolean }): Promise<Result<SeedReport>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;

  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  const schema = template.schema as TemplateSchema;

  if (readSetting<string | null>(deps, 'site.seedAppliedAt') !== null) {
    return conflict('alreadySeeded', 'Die Startinhalte wurden bereits übernommen');
  }
  const hasValues = deps.db.select().from(siteValues).all().length > 0;
  const hasEntries = deps.db.select().from(siteEntries).all().length > 0;
  if (hasValues || hasEntries) {
    return conflict('siteNotEmpty', 'Es sind schon Inhalte vorhanden; Startinhalte werden nur in eine leere Webseite übernommen');
  }

  const dir = siteTemplateDir();
  const seed = await readSeed(dir);
  if (!seed.ok) return seed;
  const doc = seed.value;

  const mediaFolder = parseFolderPath(doc.folder ?? DEFAULT_SEED_MEDIA_FOLDER);
  if (!mediaFolder) return invalid([{ path: 'folder', message: 'invalidFolderPath' }]);

  // 1. Schema-Prüfung: unbekannte Schlüssel und Wertverstöße
  for (const key of Object.keys(doc.variables)) {
    if (!(key in schema.variables)) return invalid([{ path: `variables.${key}`, message: 'unknownVariable' }]);
  }
  for (const key of Object.keys(doc.collections)) {
    if (!(key in schema.collections)) return invalid([{ path: `collections.${key}`, message: 'unknownCollection' }]);
  }
  const varShape = Object.fromEntries(
    Object.keys(doc.variables).map((k) => [k, schemaFor(schema.variables[k]!)]),
  );
  const varsChecked = validate(deps, z.object(varShape), doc.variables);
  if (!varsChecked.ok) return varsChecked;

  const entriesChecked: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, list] of Object.entries(doc.collections)) {
    const col = schema.collections[key]!;
    const dataShape = z.object(
      Object.fromEntries(Object.entries(col.fields).map(([f, fs]) => [f, schemaFor(fs).optional()])),
    );
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < list.length; i++) {
      const { slug, isPublished, sortOrder, ...data } = list[i]!;
      void sortOrder;
      const checked = validate(deps, dataShape, data);
      if (!checked.ok) return checked;
      if (col.slug && (typeof slug !== 'string' || !SLUG.test(slug))) {
        return invalid([{ path: `collections.${key}[${i}].slug`, message: 'invalidSlug' }]);
      }
      out.push({ slug: col.slug ? slug : null, isPublished: isPublished === true, data: checked.value });
    }
    entriesChecked[key] = out;
  }

  // 2. Asset-Dateien einlesen (vor jedem Schreibvorgang)
  const missing: string[] = [];
  const files = new Map<string, { filename: string; bytes: Uint8Array; mimeType: string }>();
  for (const a of doc.assets) {
    const file = path.join(seedDir(dir), 'assets', a.filename);
    try {
      files.set(a.id, { filename: a.filename, bytes: new Uint8Array(await readFile(file)), mimeType: a.mimeType });
    } catch {
      missing.push(a.filename);
    }
  }
  if (missing.length > 0) return conflict('seedAssetsMissing', `Dateien fehlen unter seed/assets/: ${missing.join(', ')}`);

  const report: SeedReport = {
    applied: false,
    variables: Object.keys(doc.variables).length,
    entries: Object.values(entriesChecked).reduce((n, l) => n + l.length, 0),
    byCollection: Object.fromEntries(Object.entries(entriesChecked).map(([k, l]) => [k, l.length])),
    assets: doc.assets.length,
  };
  if (!opts.confirm) return ok(report);

  // 3. Assets hochladen (async, jeweils eigene Transaktion; Dedup nach Inhalts-Hash).
  //    Alle Seed-Dateien wandern in einen Mediathek-Ordner (Vorgabe „Webseite“).
  if (files.size > 0 && !deps.db.select().from(core.mediaFolders).where(eq(core.mediaFolders.path, mediaFolder)).get()) {
    deps.db.transaction((tx) => {
      tx.insert(core.mediaFolders).values({ path: mediaFolder, createdAt: isoNow(deps.clock) }).run();
      recordAudit(tx, deps, ctx, {
        action: 'media.folder.create',
        entityType: 'mediaFolder',
        entityId: mediaFolder,
        after: { path: mediaFolder },
        summary: `Ordner „${mediaFolder}“ für die Startinhalte angelegt`,
      });
    });
  }
  const idMap = new Map<string, string>();
  for (const [logicalId, f] of files) {
    const stored = await storeMediaInternal(deps, ctx, {
      originalName: f.filename,
      bytes: f.bytes,
      declaredMimeType: f.mimeType,
      folder: mediaFolder,
    });
    if (!stored.ok) return stored;
    idMap.set(logicalId, stored.value.id);
  }

  const remap = (data: Record<string, unknown>, fields: Record<string, FieldSchema>): Record<string, unknown> => {
    const out = { ...data };
    for (const k of assetFieldKeys(fields)) {
      const v = out[k];
      if (typeof v === 'string' && v !== '') out[k] = idMap.get(v) ?? v;
    }
    return out;
  };

  // 4. Schreiben in einer Transaktion, ein Audit-Eintrag
  report.applied = true;
  const now = isoNow(deps.clock);
  deps.db.transaction((tx) => {
    for (const [key, value] of Object.entries(varsChecked.value as Record<string, unknown>)) {
      // Asset-Variablen gibt es bei Aluna nicht; für andere Templates trotzdem umschreiben.
      const isAsset = widgetOf(schema.variables[key]!) === 'asset';
      const mapped = isAsset && typeof value === 'string' && value !== '' ? (idMap.get(value) ?? value) : value;
      tx.insert(siteValues).values({ key, value: mapped, updatedAt: now }).run();
    }
    for (const [key, list] of Object.entries(entriesChecked)) {
      const col = schema.collections[key]!;
      list.forEach((entry, index) => {
        tx.insert(siteEntries)
          .values({
            id: newId(),
            collection: key,
            slug: entry.slug as string | null,
            sortOrder: index,
            isPublished: entry.isPublished as boolean,
            data: remap(entry.data as Record<string, unknown>, col.fields),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    }
    writeSettingInternal(tx, deps, ctx, 'site.seedAppliedAt', now);
    recordAudit(tx, deps, ctx, {
      action: 'site.seed.apply',
      entityType: 'siteTemplate',
      entityId: 'current',
      after: report,
      summary: `Startinhalte aus dem Template übernommen (${report.variables} Variablen, ${report.entries} Einträge, ${report.assets} Dateien)`,
    });
  });

  return ok(report);
}
