import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDeps,
  createProject,
  listProjects,
  emptyLocalized,
  readEnv,
  setProjectPublished,
  storeMediaAsset,
  unwrap,
  type CallContext,
  type Deps,
  type LocalizedText,
} from '@kompass/core';
import { coreDocumentTemplates, createTypstRenderer } from '@kompass/documents';
import {
  animalsModule,
  createAnimal,
  listAnimals,
  setAnimalPhotos,
  setAnimalPublished,
  setAnimalStatus,
  setAnimalStory,
  type LocalizedList,
} from '@kompass/module-animals';

async function loadAsset(
  deps: Deps,
  ctx: CallContext,
  prototypeDir: string,
  publicPath: string,
  assetCache: Map<string, string>,
): Promise<string | null> {
  if (!publicPath) return null;
  if (assetCache.has(publicPath)) return assetCache.get(publicPath)!;
  const rel = publicPath.replace(/^\/+/, '');
  const file = path.join(prototypeDir, 'public', rel);
  const bytes = new Uint8Array(await readFile(file));
  const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: path.basename(file), bytes }));
  assetCache.set(publicPath, stored.id);
  return stored.id;
}

export async function importPrototype(
  deps: Deps,
  ctx: CallContext,
  opts: { prototypeDir: string },
) {
  const locales = deps.locales();
  const leading = locales[0] ?? 'de';
  const L = (de: string): LocalizedText => {
    const res = emptyLocalized(locales);
    res[leading] = de;
    return res;
  };
  const assetCache = new Map<string, string>();
  const asset = (publicPath: string) => loadAsset(deps, ctx, opts.prototypeDir, publicPath, assetCache);
  const load = async <T,>(file: string, name: string): Promise<T> =>
    ((await import(pathToFileURL(path.join(opts.prototypeDir, 'src/data', file)).href)) as Record<string, T>)[name]!;
  const counts = { animals: 0, projects: 0 };

  const dogs = await load<any[]>('dogs.js', 'dogs');
  const existingAnimals = new Set(unwrap(await listAnimals(deps, ctx)).map((a) => a.slug));
  for (const d of dogs) {
    if (existingAnimals.has(d.slug)) continue;
    const created = unwrap(
      await createAnimal(deps, ctx, {
        slug: d.slug,
        name: d.name,
        sex: d.geschlecht === 'Rüde' ? 'male' : 'female',
        birthText: L(d.geboren ?? ''),
        sizeCm: Number(d.groesse ?? 0),
        sizeText: L(d.groesseText ?? ''),
        location: d.ort === 'Deutschland' ? 'germany' : 'shelter',
        isEmergency: !!d.notfall,
        isSponsorable: !!d.patentier,
        traits: { [leading]: d.wesen ?? [] },
        externalProfileUrl: d.hundeblicke ?? '',
        summary: L(d.kurz ?? ''),
        body: L((d.text ?? []).join('\n\n')),
      }),
    );
    const photo = await asset(d.photo);
    if (photo) unwrap(await setAnimalPhotos(deps, ctx, { id: created.id, photos: [{ assetId: photo, isPrimary: true }] }));
    if (d.status === 'reserviert') unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: 'reserved' }));
    if (d.status === 'vermittelt') {
      unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: 'adopted', adoptedYear: 2026 }));
      unwrap(
        await setAnimalStory(deps, ctx, {
          id: created.id,
          beforeAssetId: await asset(d.vorher ?? ''),
          afterAssetId: await asset(d.nachher ?? ''),
          quote: L(d.zitat ?? ''),
          family: d.familie ?? '',
          adoptedYear: 2026,
        }),
      );
    }
    unwrap(await setAnimalPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.animals += 1;
  }

  const projects = await load<any[]>('projects.js', 'projects');
  const existingProjects = new Set(unwrap(await listProjects(deps, ctx)).map((p) => p.slug));
  for (const p of projects) {
    if (existingProjects.has(p.slug)) continue;
    const created = unwrap(
      await createProject(deps, ctx, {
        slug: p.slug,
        name: L(p.titel),
        type: p.typ === 'Kurzzeitprojekt' ? 'shortTerm' : 'ongoing',
        summary: L(p.kurz ?? ''),
        body: L((p.text ?? []).join('\n\n')),
        imageAssetId: await asset(p.photo),
        betterplaceProjectId: p.betterplaceId ?? '',
      }),
    );
    unwrap(await setProjectPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.projects += 1;
  }

  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = readEnv({ SESSION_SECRET: 'import-only-not-a-real-secret-value-0000', ...process.env });
  const deps = createDeps({
    databasePath: env.databasePath,
    mediaPath: env.mediaPath,
    env: env.env,
    modules: [animalsModule],
    coreTemplates: coreDocumentTemplates(createTypstRenderer()),
  });
  const ctx: CallContext = {
    userId: null,
    permissions: new Set(deps.registry.permissionKeys),
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId: 'IMPORT',
  };
  const prototypeDir = process.env.PROTOTYPE_DIR ?? '/Users/joe/Development/Aluna Tierhilfe e.V./Webseite/aluna-static';
  importPrototype(deps, ctx, { prototypeDir })
    .then((counts) => {
      console.log('Import abgeschlossen:', counts);
      deps.close();
    })
    .catch((error) => {
      console.error(error);
      deps.close();
      process.exit(1);
    });
}
