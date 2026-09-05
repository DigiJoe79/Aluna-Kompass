import { coreModule, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createArticle, createFaq, createTeamMember, listArticles, listDownloads, listFaqs, listPublishes, listTeam, reorderArticles, setArticlePublished, setDownload, updateArticle, updateTeamMember, websiteModule } from '../src';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'media.upload']);

describe('articles', () => {
  it('creates unpublished, updates, publishes, reorders, never deletes', async () => {
    const d = deps();
    const a = unwrap(await createArticle(d, manage, { slug: 'ablauf-der-adoption', title: { de: 'Ablauf der Adoption', en: '' }, lede: { de: 'L', en: '' }, body: { de: '# Schritt 1', en: '' } }));
    const b = unwrap(await createArticle(d, manage, { slug: 'transport', title: { de: 'Transport', en: 'Transport' }, lede: { de: '', en: '' }, body: { de: 'x', en: 'x' } }));
    expect(a).toMatchObject({ isPublished: false, sortOrder: 1, publishedAt: null });
    expect(unwrap(await updateArticle(d, manage, { id: a.id, publishedAt: '2026-09-05' })).publishedAt).toBe('2026-09-05');
    expect(unwrap(await setArticlePublished(d, manage, { id: a.id, isPublished: true })).isPublished).toBe(true);
    unwrap(await reorderArticles(d, manage, { ids: [b.id, a.id] }));
    expect(unwrap(await listArticles(d, ctxWith(['website.view']))).map((x) => x.slug)).toEqual(['transport', 'ablauf-der-adoption']);
    const dup = await createArticle(d, manage, { slug: 'transport', title: { de: 'T', en: '' }, lede: { de: '', en: '' }, body: { de: '', en: '' } });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    expect(d.db.select().from(schema.auditLog).all().map((e) => e.action)).toEqual(['website.articles.create', 'website.articles.create', 'website.articles.update', 'website.articles.publish', 'website.articles.reorder']);
  });
});

describe('team and faqs', () => {
  it('manages team members with photo assets and faqs with categories', async () => {
    const d = deps();
    const photo = unwrap(await storeMediaAsset(d, manage, { originalName: 'nicole.png', bytes: PNG }));
    const m = unwrap(await createTeamMember(d, manage, { name: 'Nicole Wießner', position: { de: 'Erste Vorsitzende & Fundraising', en: 'Chairwoman & Fundraising' }, photoAssetId: photo.id }));
    expect(m.photoAssetId).toBe(photo.id);
    const missing = await updateTeamMember(d, manage, { id: m.id, petPhotoAssetId: 'nope' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
    expect(unwrap(await listTeam(d, ctxWith(['website.view'])))).toHaveLength(1);
    const f = unwrap(await createFaq(d, manage, { category: { de: 'Spenden', en: 'Donations' }, question: { de: 'Wohin geht meine Spende?', en: '' }, answer: { de: '97,2 % …', en: '' } }));
    expect(f.isPublished).toBe(false);
    expect(unwrap(await listFaqs(d, ctxWith(['website.view'])))[0]?.category.de).toBe('Spenden');
  });
});

describe('downloads', () => {
  it('lists all declared keys and accepts only PDF assets', async () => {
    const d = deps();
    expect(unwrap(await listDownloads(d, ctxWith(['website.view']))).map((x) => x.key)).toEqual(['sponsorship-form', 'membership-form', 'self-disclosure-form', 'statutes-pdf']);
    const pdf = unwrap(await storeMediaAsset(d, manage, { originalName: 'antrag.pdf', bytes: PDF, declaredMimeType: 'application/pdf' }));
    const png = unwrap(await storeMediaAsset(d, manage, { originalName: 'x.png', bytes: PNG }));
    expect(unwrap(await setDownload(d, manage, { key: 'sponsorship-form', title: { de: 'Patenschaftsantrag', en: 'Sponsorship form' }, assetId: pdf.id })).assetId).toBe(pdf.id);
    const wrong = await setDownload(d, manage, { key: 'sponsorship-form', title: { de: 'x', en: '' }, assetId: png.id });
    expect(wrong.ok === false && wrong.error.type === 'validation' && wrong.error.issues[0]?.message === 'downloadNotPdf').toBe(true);
  });
});

describe('publishes', () => {
  it('lists publishes for environment and checks permissions', async () => {
    const d = deps();
    const list = unwrap(await listPublishes(d, ctxWith(['website.view']), { environment: 'test' }));
    expect(list).toEqual([]);
    const denied = await listPublishes(d, ctxWith([]), { environment: 'test' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});
