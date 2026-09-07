import { z } from 'zod';
import type { SettingDefinition } from '@kompass/core';

export const SITE_SETTINGS: SettingDefinition[] = [
  { key: 'site.blockedTerms', schema: z.array(z.string().trim().min(2).max(80)).max(50), default: [] },
];
