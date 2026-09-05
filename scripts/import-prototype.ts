import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDeps,
  createProject,
  listProjects,
  readEnv,
  readSetting,
  setProjectPublished,
  setSetting,
  storeMediaAsset,
  unwrap,
  type CallContext,
  type Deps,
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
} from '@kompass/module-animals';
import {
  createArticle,
  createFaq,
  createTeamMember,
  getPage,
  listArticles,
  listFaqs,
  listTeam,
  setArticlePublished,
  setFaqPublished,
  setTeamMemberPublished,
  updatePage,
  websiteModule,
} from '@kompass/module-website';

type Localized = { de: string; en: string };
const L = (de: string): Localized => ({ de, en: '' });

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

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<div class="aluna-archive-grid">([\s\S]*?)<\/div>\s*$/m, '$1')
    .replace(
      /<div class="aluna-card">\s*<p class="eyebrow">(?:<span[^>]*><\/span>)?([^<]*)<\/p>\s*<h3>([^<]*)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g,
      (_m, eyebrow: string, title: string, text: string) => `### ${eyebrow.trim()} – ${title.trim()}\n${text.trim()}\n`,
    )
    .replace(/<p class="aluna-note">([\s\S]*?)<\/p>/g, (_m, t: string) => `> ${t.trim()}`)
    .replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, t: string) => `## ${t.replace(/<em>(.*?)<\/em>/g, '*$1*').trim()}`)
    .replace(/<h3>([\s\S]*?)<\/h3>/g, (_m, t: string) => `### ${t.trim()}`)
    .replace(/<li>([\s\S]*?)<\/li>/g, (_m, t: string) => `- ${t.trim()}`)
    .replace(/<\/?(ul|ol)>/g, '')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<p>([\s\S]*?)<\/p>/g, (_m, t: string) => `${t.trim()}\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wrapCards(markdown: string): string {
  // Folgen von "### …"-Karten aus aluna-card-Blöcken in einen :::karten-Container heben
  if (markdown.includes('### 3 Tage')) {
    return markdown.replace(/(### 3 Tage[\s\S]*?### 3 Monate[^\n]*\n[^\n]*)/, ':::karten\n$1\n:::');
  }
  if (markdown.includes('### Schritt')) {
    return `:::karten\n${markdown}\n:::`;
  }
  return markdown;
}

export async function importPrototype(
  deps: Deps,
  ctx: CallContext,
  opts: { prototypeDir: string; pagesFile: string },
) {
  const assetCache = new Map<string, string>();
  const asset = (publicPath: string) => loadAsset(deps, ctx, opts.prototypeDir, publicPath, assetCache);
  const load = async <T,>(file: string, name: string): Promise<T> =>
    ((await import(pathToFileURL(path.join(opts.prototypeDir, 'src/data', file)).href)) as Record<string, T>)[name]!;
  const counts = { animals: 0, projects: 0, team: 0, faqs: 0, articles: 0, pages: 0, facts: 0 };

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
        traits: { de: d.wesen ?? [], en: [] },
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

  const team = await load<any[]>('team.js', 'team');
  const existingTeam = new Set(unwrap(await listTeam(deps, ctx)).map((m) => m.name));
  for (const m of team) {
    if (existingTeam.has(m.name)) continue;
    const created = unwrap(
      await createTeamMember(deps, ctx, {
        name: m.name,
        position: L(m.rolle),
        photoAssetId: await asset(m.foto),
      }),
    );
    unwrap(await setTeamMemberPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.team += 1;
  }

  const faq = await load<any[]>('faq.js', 'faq');
  const existingFaqs = new Set(unwrap(await listFaqs(deps, ctx)).map((f) => f.question.de));
  for (const group of faq) {
    for (const f of group.fragen) {
      if (existingFaqs.has(f.q)) continue;
      const created = unwrap(
        await createFaq(deps, ctx, {
          category: L(group.kategorie),
          question: L(f.q),
          answer: L(f.a),
        }),
      );
      unwrap(await setFaqPublished(deps, ctx, { id: created.id, isPublished: true }));
      counts.faqs += 1;
    }
  }

  const articles = await load<any[]>('articles.js', 'articles');
  const existingArticles = new Set(unwrap(await listArticles(deps, ctx)).map((a) => a.slug));
  for (const a of articles) {
    if (a.slug === 'ablauf-der-adoption' || existingArticles.has(a.slug)) continue;
    const created = unwrap(
      await createArticle(deps, ctx, {
        slug: a.slug,
        title: L(a.titel),
        lede: L(a.lede ?? ''),
        body: L(wrapCards(htmlToMarkdown(a.body ?? ''))),
      }),
    );
    unwrap(await setArticlePublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.articles += 1;
  }

  const pagesFile = JSON.parse(await readFile(opts.pagesFile, 'utf8')) as {
    facts: Record<string, unknown>;
    pages: Record<string, { title: Localized; lede: Localized; body: Localized; blocks: unknown[] }>;
  };
  for (const [key, page] of Object.entries(pagesFile.pages)) {
    const current = unwrap(await getPage(deps, ctx, key));
    if (current.title.de) continue;
    unwrap(await updatePage(deps, ctx, { key, ...page }));
    counts.pages += 1;
  }
  for (const [k, v] of Object.entries(pagesFile.facts)) {
    const key = `website.${k}`;
    const currentValue = readSetting(deps, key);
    if (JSON.stringify(currentValue) === JSON.stringify(v)) continue;
    unwrap(await setSetting(deps, ctx, { key, value: v }));
    counts.facts += 1;
  }
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = readEnv({ SESSION_SECRET: 'import-only-not-a-real-secret-value-0000', ...process.env });
  const deps = createDeps({
    databasePath: env.databasePath,
    mediaPath: env.mediaPath,
    env: env.env,
    modules: [websiteModule, animalsModule],
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
  importPrototype(deps, ctx, { prototypeDir, pagesFile: path.resolve(import.meta.dirname, 'prototype-pages.json') })
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
