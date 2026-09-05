import { readSiteEnv, type SiteEnv } from '@kompass/module-website';

export const siteEnv = (): SiteEnv => readSiteEnv();
