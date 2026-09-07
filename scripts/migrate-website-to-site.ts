import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type CallContext,
  type Deps,
  type Result,
  type ValidationIssue,
  conflict,
  createDeps,
  emptyLocalized,
  invalid,
  ok,
  readEnv,
  readSetting,
  setSetting,
  validate,
} from '@kompass/core';
import { animalsModule } from '@kompass/module-animals';
import {
  SLUG,
  activeTemplate,
  createEntry,
  schemaFor,
  setEntryPublished,
  setValues,
  siteEntries,
  siteModule,
  siteValues,
  type TemplateSchema,
} from '@kompass/module-site';
import {
  WEBSITE_PAGE_KEYS,
  websiteArticles,
  websiteDownloads,
  websiteFaqs,
  websiteModule,
  websitePages,
  websiteTeam,
  type WebsitePageKey,
} from '@kompass/module-website';

// Bewusst kein Import von `drizzle-orm` oder `zod`: Skripte unter `scripts/`
// haben keine eigenen node_modules und lösen keine bloßen Paketnamen auf, nur
// was ein `@kompass/*`-Paket bereits mitbringt (`schemaFor`, `validate`, …).
// Sortiert wird deshalb in JavaScript statt über `orderBy`.

/**
 * Die Zuordnung von Alunas Bestand ins Modell des Moduls `site` — als Tabelle
 * im Code, nicht als Automatik (siehe Plan `2026-09-07-site-5-cutover.md`,
 * Task 2). Sie gilt für Alunas Template; ein anderer Verein bräuchte eine
 * eigene Fassung dieses Skripts.
 */
const PAGE_FIELDS: { page: WebsitePageKey; field: 'lede' | 'body'; variable: string }[] = [
  { page: 'home', field: 'lede', variable: 'homeLede' },
  { page: 'help', field: 'body', variable: 'helpText' },
  { page: 'donate', field: 'body', variable: 'donateText' },
  { page: 'sponsor', field: 'body', variable: 'sponsorText' },
  { page: 'membership', field: 'body', variable: 'membershipText' },
  { page: 'about', field: 'body', variable: 'aboutText' },
  { page: 'partners', field: 'body', variable: 'partnersText' },
];

/** Einstellung von `website` → Variable in `site`. */
const SETTING_FIELDS: { setting: string; variable: string }[] = [
  { setting: 'website.forwardingPercent', variable: 'forwardingPercent' },
  { setting: 'website.shelterDogCount', variable: 'shelterDogCount' },
  { setting: 'website.featuredAnimalSlug', variable: 'featuredAnimalSlug' },
  { setting: 'website.featuredStorySlug', variable: 'featuredStorySlug' },
];

/** Einstellung von `website` → gleichnamige Einstellung in `site`. */
const SETTING_RENAMES: { from: string; to: string }[] = [{ from: 'website.blockedTerms', to: 'site.blockedTerms' }];

/** Einstellungen, die bewusst nicht umziehen — künftig fest im Astro-Code des Templates. */
const SETTINGS_LEFT_BEHIND = [
  'website.claim',
  'website.donationBoxLocations',
  'website.section11Status',
  'website.section11Date',
  'website.socialLinks',
  'website.betterplaceMetaProjectId',
  'website.betterplaceDefaultAmount',
] as const;

const PAGE_FIELD_NAMES = ['title', 'lede', 'body', 'metaDescription'] as const;

export interface MigrationReportLine {
  table: string;
  count: number;
}

export interface LeftBehindItem {
  field: string;
  hadContent: boolean;
}

export interface MigrationReport {
  lines: MigrationReportLine[];
  leftBehind: LeftBehindItem[];
}

export interface MigrateOptions {
  dryRun?: boolean;
}

interface PlannedEntry {
  collection: string;
  slug: string | null;
  data: Record<string, unknown>;
  /** `null` heisst: Die Sammlung kennt keinen Veröffentlicht-Schalter. */
  isPublished: boolean | null;
}

/** Ob an einem Wert überhaupt etwas dranhängt — für den Bericht des Zurückgelassenen. */
function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.some((v) => hasContent(v));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((v) => hasContent(v));
  return false;
}

interface CollectedValues {
  values: Record<string, unknown>;
  leftBehind: LeftBehindItem[];
}

/**
 * Liest die sieben Seitentexte und die vier Einstellungen, die zu Variablen
 * werden. Jedes Seitenfeld, das nicht in `PAGE_FIELDS` steht — auch bei den
 * fünf vollständig zurückbleibenden Seiten —, landet automatisch im Bericht
 * des Zurückgelassenen; so kann keine Seite unbemerkt durchrutschen.
 */
function collectValues(deps: Deps): CollectedValues {
  const empty = emptyLocalized(deps.locales());
  const rows = new Map(deps.db.select().from(websitePages).all().map((r) => [r.key, r]));
  const values: Record<string, unknown> = {};
  const leftBehind: LeftBehindItem[] = [];

  for (const key of WEBSITE_PAGE_KEYS) {
    const row = rows.get(key);
    const fields = {
      title: row?.title ?? empty,
      lede: row?.lede ?? empty,
      body: row?.body ?? empty,
      metaDescription: row?.metaDescription ?? empty,
      blocks: row?.blocks ?? [],
    };
    for (const field of PAGE_FIELD_NAMES) {
      const mapping = PAGE_FIELDS.find((m) => m.page === key && m.field === field);
      if (mapping) {
        values[mapping.variable] = fields[field];
      } else {
        leftBehind.push({ field: `website_pages.${key}.${field}`, hadContent: hasContent(fields[field]) });
      }
    }
    leftBehind.push({ field: `website_pages.${key}.blocks`, hadContent: hasContent(fields.blocks) });
  }

  for (const mapping of SETTING_FIELDS) {
    values[mapping.variable] = readSetting(deps, mapping.setting);
  }

  return { values, leftBehind };
}

function collectSettingsLeftBehind(deps: Deps): LeftBehindItem[] {
  return SETTINGS_LEFT_BEHIND.map((key) => ({ field: key, hadContent: hasContent(readSetting(deps, key)) }));
}

const bySortOrder = <T extends { sortOrder: number }>(rows: T[]): T[] => [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

function articlesFrom(deps: Deps): PlannedEntry[] {
  return bySortOrder(deps.db.select().from(websiteArticles).all()).map((r) => ({
    collection: 'articles',
    slug: r.slug,
    data: { title: r.title, lede: r.lede, body: r.body },
    isPublished: r.isPublished,
  }));
}

function teamFrom(deps: Deps): PlannedEntry[] {
  return bySortOrder(deps.db.select().from(websiteTeam).all()).map((r) => ({
    collection: 'team',
    slug: null,
    data: { name: r.name, position: r.position, photoAssetId: r.photoAssetId, petPhotoAssetId: r.petPhotoAssetId },
    isPublished: r.isPublished,
  }));
}

function faqFrom(deps: Deps): PlannedEntry[] {
  return bySortOrder(deps.db.select().from(websiteFaqs).all()).map((r) => ({
    collection: 'faq',
    slug: null,
    data: { category: r.category, question: r.question, answer: r.answer },
    isPublished: r.isPublished,
  }));
}

function downloadsFrom(deps: Deps): PlannedEntry[] {
  return [...deps.db.select().from(websiteDownloads).all()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => ({ collection: 'downloads', slug: r.key, data: { title: r.title, fileAssetId: r.assetId }, isPublished: null }));
}

function validateValues(deps: Deps, schema: TemplateSchema, values: Record<string, unknown>, issues: ValidationIssue[]): void {
  for (const [key, value] of Object.entries(values)) {
    const field = schema.variables[key];
    if (!field) {
      issues.push({ path: `values.${key}`, message: 'unknownVariable' });
      continue;
    }
    const result = validate(deps, schemaFor(field), value);
    if (!result.ok && result.error.type === 'validation') {
      for (const issue of result.error.issues) {
        issues.push({ path: `values.${key}${issue.path ? `.${issue.path}` : ''}`, message: issue.message });
      }
    }
  }
}

/** Validiert Feld für Feld statt über ein zusammengesetztes Objektschema — Skripte binden kein `zod` selbst ein. */
function validateEntries(deps: Deps, schema: TemplateSchema, collection: string, entries: PlannedEntry[], issues: ValidationIssue[]): void {
  const col = schema.collections[collection];
  if (!col) {
    if (entries.length > 0) issues.push({ path: `entries.${collection}`, message: 'unknownCollection' });
    return;
  }
  entries.forEach((entry, index) => {
    if (col.slug && (!entry.slug || !SLUG.test(entry.slug))) {
      issues.push({ path: `entries.${collection}[${index}].slug`, message: 'invalidSlug' });
    }
    for (const [key, field] of Object.entries(col.fields)) {
      if (!(key in entry.data)) continue;
      const result = validate(deps, schemaFor(field), entry.data[key]);
      if (!result.ok && result.error.type === 'validation') {
        for (const issue of result.error.issues) {
          issues.push({ path: `entries.${collection}[${index}].${key}${issue.path ? `.${issue.path}` : ''}`, message: issue.message });
        }
      }
    }
  });
}

async function writeAll(
  deps: Deps,
  ctx: CallContext,
  planned: { values: Record<string, unknown>; articles: PlannedEntry[]; team: PlannedEntry[]; faq: PlannedEntry[]; downloads: PlannedEntry[] },
): Promise<Result<null>> {
  const valuesResult = await setValues(deps, ctx, { values: planned.values });
  if (!valuesResult.ok) return valuesResult;

  for (const list of [planned.articles, planned.team, planned.faq, planned.downloads]) {
    for (const entry of list) {
      const created = await createEntry(deps, ctx, { collection: entry.collection, slug: entry.slug ?? undefined, data: entry.data });
      if (!created.ok) return created;
      if (entry.isPublished) {
        const published = await setEntryPublished(deps, ctx, { id: created.value.id, isPublished: true });
        if (!published.ok) return published;
      }
    }
  }

  for (const rename of SETTING_RENAMES) {
    const result = await setSetting(deps, ctx, { key: rename.to, value: readSetting(deps, rename.from) });
    if (!result.ok) return result;
  }

  return ok(null);
}

/**
 * Überführt Alunas Bestand aus den `website_*`-Tabellen in `site_values` und
 * `site_entries`, geschrieben über die Dienste des Moduls `site` (Prinzip 8).
 * Läuft einmalig gegen Testdaten (Prinzip 9): validiert zuerst alles gegen das
 * aktive Template und schreibt nur, wenn alles besteht — sonst bliebe ein
 * halb migrierter Stand zurück, den der Zweitlauf-Riegel danach blockiert.
 */
export async function migrateWebsiteToSite(deps: Deps, ctx: CallContext, opts: MigrateOptions = {}): Promise<Result<MigrationReport>> {
  if (deps.env === 'production') {
    return conflict('migrationNotAllowedInProduction', 'Der Umzug von website nach site läuft nur gegen Testdaten, nie gegen Produktion');
  }

  const existingValues = deps.db.select({ key: siteValues.key }).from(siteValues).all();
  const existingEntries = deps.db.select({ id: siteEntries.id }).from(siteEntries).all();
  if (existingValues.length > 0 || existingEntries.length > 0) {
    return conflict('alreadyMigrated', 'site_values oder site_entries enthalten bereits Daten; der Umzug läuft nur einmal');
  }

  const template = activeTemplate(deps);
  if (!template) {
    return conflict('noTemplate', 'Es ist kein Template eingelesen; ohne Template kennt site keine Sammlungen oder Variablen');
  }

  const { values, leftBehind: pagesLeftBehind } = collectValues(deps);
  const articles = articlesFrom(deps);
  const team = teamFrom(deps);
  const faq = faqFrom(deps);
  const downloads = downloadsFrom(deps);
  const settingsLeftBehind = collectSettingsLeftBehind(deps);

  const issues: ValidationIssue[] = [];
  validateValues(deps, template.schema, values, issues);
  validateEntries(deps, template.schema, 'articles', articles, issues);
  validateEntries(deps, template.schema, 'team', team, issues);
  validateEntries(deps, template.schema, 'faq', faq, issues);
  validateEntries(deps, template.schema, 'downloads', downloads, issues);
  if (issues.length > 0) return invalid(issues);

  const report: MigrationReport = {
    lines: [
      { table: 'website_pages', count: PAGE_FIELDS.length },
      { table: 'website_articles', count: articles.length },
      { table: 'website_team', count: team.length },
      { table: 'website_faqs', count: faq.length },
      { table: 'website_downloads', count: downloads.length },
      { table: 'settings', count: SETTING_FIELDS.length + SETTING_RENAMES.length },
    ],
    leftBehind: [...pagesLeftBehind, ...settingsLeftBehind],
  };

  if (opts.dryRun) return ok(report);

  const written = await writeAll(deps, ctx, { values, articles, team, faq, downloads });
  if (!written.ok) return written;

  return ok(report);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(import.meta.dirname, '..');
  const runtime = readEnv({ SESSION_SECRET: 'migrate-website-to-site-not-a-real-secret-00', ...process.env });
  const dryRun = process.argv.includes('--dry-run');
  const deps = createDeps({
    databasePath: process.env.DATABASE_PATH ?? path.join(root, 'apps/kompass/data/kompass.db'),
    mediaPath: process.env.MEDIA_PATH ?? path.join(root, 'apps/kompass/media'),
    env: runtime.env,
    modules: [websiteModule, siteModule, animalsModule],
  });
  const ctx: CallContext = {
    userId: null,
    permissions: new Set(deps.registry.permissionKeys),
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId: 'MIGRATE-WEBSITE-TO-SITE',
  };
  migrateWebsiteToSite(deps, ctx, { dryRun })
    .then((result) => {
      if (!result.ok) {
        console.error('Migration abgebrochen:', JSON.stringify(result.error, null, 2));
        process.exitCode = 1;
        return;
      }
      console.log(dryRun ? 'Probelauf — nichts geschrieben.' : 'Migriert.');
      console.log('Je Quelltabelle:');
      for (const line of result.value.lines) console.log(`  ${line.table}: ${line.count}`);
      console.log('Bewusst nicht übernommen:');
      for (const item of result.value.leftBehind) console.log(`  ${item.field} (${item.hadContent ? 'hatte Inhalt' : 'war leer'})`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => deps.close());
}
