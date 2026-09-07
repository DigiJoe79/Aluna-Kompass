import { readSiteEnv, type SiteEnv } from '@kompass/module-site';

export const siteEnv = (): SiteEnv => readSiteEnv();

