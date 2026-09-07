import { coreModule, createProject, setProjectPublished, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createArticle, publishedArticles, publishedPages, publishedProjects, publishedSiteFacts, setArticlePublished, updatePage, websiteModule } from '../src';

const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule], locales: ['de', 'en'] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'settings.manage']);

describe('published views', () => {
  it('expose only published records and only declared fields', async () => {
    const d = deps();
    const a = unwrap(await createArticle(d, manage, { slug: 'a', title: { de: 'A', en: '' }, lede: { de: '', en: '' }, body: { de: 'x', en: '' } }));
    unwrap(await createArticle(d, manage, { slug: 'b', title: { de: 'B', en: '' }, lede: { de: '', en: '' }, body: { de: 'x', en: '' } }));
    unwrap(await setArticlePublished(d, manage, { id: a.id, isPublished: true }));
    const rows = publishedArticles.load(d);
    expect(rows.map((r) => r.slug)).toEqual(['a']);
    expect(Object.keys(rows[0]!).sort()).toEqual(['body', 'lede', 'publishedAt', 'slug', 'sortOrder', 'title']);
  });

  it('pages view lists all declared pages; projects only published; facts merge settings and organization', async () => {
    const d = deps();
    unwrap(await updatePage(d, manage, { key: 'about', title: { de: 'Über uns', en: 'About' } }));
    expect(publishedPages.load(d).find((p) => p.key === 'about')?.title.en).toBe('About');
    const p = unwrap(await createProject(d, manage, { slug: 'p', name: { de: 'P', en: '' }, type: 'ongoing', summary: { de: '', en: '' }, body: { de: '', en: '' } }));
    expect(publishedProjects.load(d)).toEqual([]);
    unwrap(await setProjectPublished(d, manage, { id: p.id, isPublished: true }));
    expect(publishedProjects.load(d).map((x) => x.slug)).toEqual(['p']);
    unwrap(await setSetting(d, manage, { key: 'website.shelterDogCount', value: 150 }));
    unwrap(await setSetting(d, manage, { key: 'organization.name', value: 'Aluna Tierhilfe e.V.' }));
    unwrap(await setSetting(d, manage, { key: 'organization.foundedYear', value: '2026' }));
    const facts = publishedSiteFacts.load(d)[0]!;
    expect(facts).toMatchObject({ shelterDogCount: 150, forwardingPercent: 97.2, organization: { name: 'Aluna Tierhilfe e.V.', foundedYear: '2026' } });
    expect('blockedTerms' in facts).toBe(false);
  });
});
