import { localizedText, type SettingDefinition } from '@kompass/core';
import { z } from 'zod';

const slugOrAuto = z.union([z.literal('auto'), z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/)]);
const httpUrl = z.url().refine((u) => /^https?:\/\//.test(u), 'httpOnly');

export const WEBSITE_SETTINGS: SettingDefinition[] = [
  { key: 'website.claim', schema: localizedText({ max: 120 }), default: { de: '' } },
  { key: 'website.forwardingPercent', schema: z.number().min(0).max(100), default: 97.2 },
  { key: 'website.shelterDogCount', schema: z.number().int().min(0), default: 0 },
  { key: 'website.donationBoxLocations', schema: z.array(z.string().trim().min(1).max(80)).max(20), default: [] },
  { key: 'website.section11Status', schema: z.enum(['pending', 'granted']), default: 'pending' },
  { key: 'website.section11Date', schema: z.union([z.literal(''), z.iso.date()]), default: '' },
  { key: 'website.socialLinks', schema: z.array(z.object({ label: z.string().trim().min(1).max(40), href: httpUrl })).max(10), default: [] },
  { key: 'website.betterplaceMetaProjectId', schema: z.string().trim().max(40), default: '' },
  { key: 'website.betterplaceDefaultAmount', schema: z.number().int().min(1).max(10_000), default: 50 },
  { key: 'website.blockedTerms', schema: z.array(z.string().trim().min(2).max(80)).max(50), default: [] },
  { key: 'website.featuredAnimalSlug', schema: slugOrAuto, default: 'auto' },
  { key: 'website.featuredStorySlug', schema: slugOrAuto, default: 'auto' },
];
