import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { L } from './locale';

export interface Asset { id: string; filename: string; mimeType: string; width: number | null; height: number | null }
export interface Facts {
  claim: L;
  forwardingPercent: number;
  shelterDogCount: number;
  donationBoxLocations: string[];
  section11Status: 'pending' | 'granted';
  section11Date: string;
  socialLinks: { label: string; href: string }[];
  betterplaceMetaProjectId: string;
  betterplaceDefaultAmount: number;
  featuredAnimalSlug: string;
  featuredStorySlug: string;
  organization: Record<string, string>;
}
export interface Block { id: string; title: L; text: L; imageAssetId: string | null; href: string; label: L }
export interface Page { key: string; title: L; lede: L; body: L; metaDescription: L; blocks: Block[] }
export interface Article { slug: string; title: L; lede: L; body: L; publishedAt: string | null; sortOrder: number }
export interface TeamMember { name: string; position: L; photoAssetId: string | null; petPhotoAssetId: string | null; sortOrder: number }
export interface Faq { category: L; question: L; answer: L; sortOrder: number }
export interface Project { slug: string; name: L; type: 'ongoing' | 'shortTerm'; status: string; summary: L; body: L; imageAssetId: string | null; betterplaceProjectId: string; sortOrder: number }
export interface Download { key: string; title: L; assetId: string }
export interface Animal {
  slug: string;
  name: string;
  sex: 'female' | 'male';
  birthText: L;
  sizeCm: number;
  sizeText: L;
  location: 'shelter' | 'germany';
  status: 'lookingForHome' | 'reserved' | 'adopted';
  isEmergency: boolean;
  isSponsorable: boolean;
  traits: { de: string[]; en: string[] };
  externalProfileUrl: string;
  summary: L;
  body: L;
  photos: { assetId: string; sortOrder: number; isPrimary: boolean }[];
  story: { beforeAssetId: string | null; afterAssetId: string | null; quote: L; family: string; adoptedYear: number } | null;
}
export interface SiteContent {
  facts: Facts[];
  pages: Page[];
  articles: Article[];
  team: TeamMember[];
  faqs: Faq[];
  projects: Project[];
  downloads: Download[];
  animals?: Animal[];
  assets: Asset[];
}

export const CONTENT_DIR = process.env.SITE_CONTENT_DIR ?? path.resolve(process.cwd(), 'fixtures/example');
export const PUBLIC_URL = process.env.SITE_PUBLIC_URL ?? 'https://example.org';
export const IS_STAGING = process.env.SITE_STAGING === '1';

let cache: Promise<SiteContent> | null = null;
export function loadContent(): Promise<SiteContent> {
  cache ??= readFile(path.join(CONTENT_DIR, 'content.json'), 'utf8').then((raw) => JSON.parse(raw) as SiteContent);
  return cache;
}

export const factsOf = (c: SiteContent): Facts => c.facts[0]!;
export const pageOf = (c: SiteContent, key: string): Page =>
  c.pages.find((p) => p.key === key) ?? { key, title: { de: '', en: '' }, lede: { de: '', en: '' }, body: { de: '', en: '' }, metaDescription: { de: '', en: '' }, blocks: [] };
export const animalsOf = (c: SiteContent): Animal[] => c.animals ?? [];
