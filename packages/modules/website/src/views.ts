import { definePublishedView, localizedText, readAllSettings, schema as core, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { pageBlockSchema } from './services/pages';
import { ensurePages } from './services/pages';
import { websiteArticles, websiteDownloads, websiteFaqs, websitePages, websiteTeam } from './schema';

const L = localizedText();

export const publishedSiteFacts = definePublishedView({
  name: 'facts',
  schema: z.object({
    claim: L,
    forwardingPercent: z.number(),
    shelterDogCount: z.number(),
    donationBoxLocations: z.array(z.string()),
    section11Status: z.enum(['pending', 'granted']),
    section11Date: z.string(),
    socialLinks: z.array(z.object({ label: z.string(), href: z.string() })),
    betterplaceMetaProjectId: z.string(),
    betterplaceDefaultAmount: z.number(),
    featuredAnimalSlug: z.string(),
    featuredStorySlug: z.string(),
    organization: z.object({
      name: z.string(),
      street: z.string(),
      postalCode: z.string(),
      city: z.string(),
      email: z.string(),
      phone: z.string(),
      iban: z.string(),
      bic: z.string(),
      bankName: z.string(),
      registerCourt: z.string(),
      registerNumber: z.string(),
    }),
  }),
  load: (deps: Deps) => {
    const all = readAllSettings(deps);
    const w = (k: string) => all[`website.${k}`];
    const o = (k: string) => String(all[`organization.${k}`] ?? '');
    return [{
      claim: w('claim'),
      forwardingPercent: w('forwardingPercent'),
      shelterDogCount: w('shelterDogCount'),
      donationBoxLocations: w('donationBoxLocations'),
      section11Status: w('section11Status'),
      section11Date: w('section11Date'),
      socialLinks: w('socialLinks'),
      betterplaceMetaProjectId: w('betterplaceMetaProjectId'),
      betterplaceDefaultAmount: w('betterplaceDefaultAmount'),
      featuredAnimalSlug: w('featuredAnimalSlug'),
      featuredStorySlug: w('featuredStorySlug'),
      organization: {
        name: o('name'),
        street: o('street'),
        postalCode: o('postalCode'),
        city: o('city'),
        email: o('email'),
        phone: o('phone'),
        iban: o('iban'),
        bic: o('bic'),
        bankName: o('bankName'),
        registerCourt: o('registerCourt'),
        registerNumber: o('registerNumber'),
      },
    }];
  },
});

export const publishedPages = definePublishedView({
  name: 'pages',
  schema: z.object({ key: z.string(), title: L, lede: L, body: L, metaDescription: L, blocks: z.array(pageBlockSchema) }),
  load: (deps) => { ensurePages(deps); return deps.db.select().from(websitePages).all(); },
});

export const publishedArticles = definePublishedView({
  name: 'articles',
  schema: z.object({ slug: z.string(), title: L, lede: L, body: L, publishedAt: z.string().nullable(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteArticles).where(eq(websiteArticles.isPublished, true)).orderBy(asc(websiteArticles.sortOrder)).all(),
});

export const publishedTeam = definePublishedView({
  name: 'team',
  schema: z.object({ id: z.string(), name: z.string(), position: L, photoAssetId: z.string().nullable(), petPhotoAssetId: z.string().nullable(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteTeam).where(eq(websiteTeam.isPublished, true)).orderBy(asc(websiteTeam.sortOrder)).all(),
});

export const publishedFaqs = definePublishedView({
  name: 'faqs',
  schema: z.object({ category: L, question: L, answer: L, sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteFaqs).where(eq(websiteFaqs.isPublished, true)).orderBy(asc(websiteFaqs.sortOrder)).all(),
});

export const publishedProjects = definePublishedView({
  name: 'projects',
  schema: z.object({ slug: z.string(), name: L, type: z.enum(['ongoing', 'shortTerm']), status: z.enum(['active', 'completed']), summary: L, body: L, imageAssetId: z.string().nullable(), betterplaceProjectId: z.string(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(core.projects).where(eq(core.projects.isPublished, true)).orderBy(asc(core.projects.sortOrder)).all(),
});

export const publishedDownloads = definePublishedView({
  name: 'downloads',
  schema: z.object({ key: z.string(), title: L, assetId: z.string() }),
  load: (deps) => deps.db.select().from(websiteDownloads).all().filter((d) => d.assetId !== null),
});

export const WEBSITE_VIEWS = [publishedSiteFacts, publishedPages, publishedArticles, publishedTeam, publishedFaqs, publishedProjects, publishedDownloads];
