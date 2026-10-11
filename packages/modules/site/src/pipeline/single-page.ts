import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { conflict, invalid, ok, type Deps, type Result } from '@kompass/core';
import { contentAssetIds, gatherAssets, mediaAssetSource, type AssetSource } from '../export';
import { canonical, pruneLocales, readPublicContent } from '../public-content';
import { activeTemplate } from '../service';
import { buildSite } from './build';
import { copyImagesIfAny } from './jobs';
import type { SiteEnv } from './env';
import { prepareImageVariants, sweepImageCache } from './images';

/**
 * Vorschau einer einzelnen Zeile einer Sicht (Plan Vorschläge B, Spike 2026-10-10: ~0,6 s warm): Die Vorlage bekommt
 * den öffentlichen Stand, nur in `views[view]` steht allein die übergebene Zeile. Gebaut wird in einem eigenen Ordner
 * neben dem Cache der Läufe (`site-single/<key>/`), mit eigenem Bild-Cache und ohne die Sperre der Läufe — eine
 * laufende Vorschau oder ein Publish bleiben unberührt. Ordner älter als eine Stunde räumt der nächste Bau weg.
 * Ohne `ctx`: Das Recht prüft der Aufrufer (für Tiere `animals.manage`).
 */
export interface SinglePageBuild {
  /** Der gebaute Ordner (Wurzel der Webseite). */
  dir: string;
  ms: number;
  /** Schon gebaut, nur nachgeschlagen. */
  cached: boolean;
}

/** Ein Bild, das noch nicht in der Mediathek liegt (Zwischenablage eines Vorschlags). */
export type SingleAsset = AssetSource;

const KEY = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_AGE_MS = 3_600_000;
const DONE = '.done';
const running = new Map<string, Promise<Result<SinglePageBuild>>>();
/**
 * Ein Bau nach dem anderen: Alle teilen `img-cache`, und `prepareImageVariants` räumt dort zu Beginn halbfertige
 * Dateien weg — auch die eines zweiten Baus, der gerade schreibt (Reviewer I4). Warm dauert ein Bau unter einer Sekunde.
 */
let chain: Promise<unknown> = Promise.resolve();

export function singlePageRoot(env: Pick<SiteEnv, 'cacheDir'>): string {
  return path.join(path.dirname(env.cacheDir), 'site-single');
}

async function pruneOld(root: string, keep: string): Promise<void> {
  const names = await readdir(root).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of names) {
    if (name === keep || name === 'img-cache' || name === 'stage') continue;
    const info = await stat(path.join(root, name)).catch(() => null);
    if (info && now - info.mtimeMs > MAX_AGE_MS) await rm(path.join(root, name), { recursive: true, force: true });
  }
}

async function build(deps: Deps, env: SiteEnv, input: { view: string; row: unknown; key: string; extraAssets?: SingleAsset[] }): Promise<Result<SinglePageBuild>> {
  const started = Date.now();
  const root = singlePageRoot(env);
  const dir = path.join(root, input.key);
  const out = path.join(dir, 'out');
  if (existsSync(path.join(dir, DONE))) return ok({ dir: out, ms: Date.now() - started, cached: true });
  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  const content = readPublicContent(deps, template);
  if (!content.ok) return content;
  const { variables, collections } = content.value;
  if (!(input.view in content.value.views)) return conflict('viewNotInTemplate', `Die Vorlage nutzt die Sicht ${input.view} nicht`);
  // Die Zeile kommt ungespeichert vom Aufrufer: dieselben Sprachen wie der öffentliche Stand, nie eine fremde.
  const views = { ...content.value.views, [input.view]: [pruneLocales(input.row, content.value.locales)] };

  await mkdir(root, { recursive: true });
  await pruneOld(root, input.key);
  await rm(dir, { recursive: true, force: true });
  const job = path.join(dir, 'job');
  await mkdir(path.join(job, 'assets'), { recursive: true });
  // Bilder eines Vorschlags vor der Mediathek; eine abgeleitete ID setzt auf ihre Basis-ID auf.
  const extra = new Map((input.extraAssets ?? []).map((a) => [a.id, a]));
  const ids = contentAssetIds(template.schema, { variables, collections, views });
  const assets = await gatherAssets(ids, (id) => extra.get(id) ?? mediaAssetSource(deps, id), path.join(job, 'assets'));
  await writeFile(path.join(job, 'content.json'), JSON.stringify(canonical({ variables, collections, views, assets }), null, 2));
  // `pruneOld` lässt `img-cache` stehen; ohne eigenes Aufräumen wüchse er mit jeder Vorschau (Backlog 67, gleiche Regel).
  const imgCache = path.join(root, 'img-cache');
  const images = await prepareImageVariants({ jobDir: job, assets, cacheDir: imgCache });
  await sweepImageCache(imgCache, images.cacheNames);
  await buildSite({ siteDir: env.templateDir, contentDir: job, outDir: out, publicUrl: env.publicUrl || 'http://localhost', staging: true, stageRoot: path.join(root, 'stage'), timeoutMs: 120_000 });
  await copyImagesIfAny(path.join(job, 'images'), path.join(out, 'images'));
  await rm(job, { recursive: true, force: true });
  await writeFile(path.join(dir, DONE), '');
  return ok({ dir: out, ms: Date.now() - started, cached: false });
}

export async function buildSinglePage(deps: Deps, env: SiteEnv, input: { view: string; row: unknown; key: string; extraAssets?: SingleAsset[] }): Promise<Result<SinglePageBuild>> {
  if (!KEY.test(input.key)) return invalid([{ path: 'key', message: 'invalid' }]);
  // Derselbe Schlüssel zweimal zugleich (Doppelklick, zwei Fenster): ein Bau, beide warten darauf.
  const pending = running.get(input.key);
  if (pending) return pending;
  const job = chain.then(() => build(deps, env, input)).finally(() => running.delete(input.key));
  chain = job.catch(() => undefined);
  running.set(input.key, job);
  return job;
}
