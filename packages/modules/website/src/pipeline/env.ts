import path from 'node:path';

export interface DeployTarget {
  host: string;
  user: string;
  path: string;
  keyFile: string;
}

export interface SiteEnv {
  publicUrl: string | null;
  staging: boolean;
  deploy: DeployTarget | null;
  siteDir: string;
  cacheDir: string;
  previewDir: string;
}

export function readSiteEnv(env: Record<string, string | undefined> = process.env): SiteEnv {
  const dataDir = path.dirname(env.DATABASE_PATH ?? './data/kompass.db');
  const deploy = env.SITE_DEPLOY_HOST !== undefined && env.SITE_DEPLOY_USER !== undefined && env.SITE_DEPLOY_PATH && env.SITE_DEPLOY_KEY_FILE !== undefined
    ? { host: env.SITE_DEPLOY_HOST, user: env.SITE_DEPLOY_USER, path: env.SITE_DEPLOY_PATH, keyFile: env.SITE_DEPLOY_KEY_FILE }
    : null;
  return {
    publicUrl: env.SITE_PUBLIC_URL ?? null,
    staging: env.SITE_STAGING === '1',
    deploy,
    siteDir: env.SITE_DIR ?? path.resolve(process.cwd(), '../../apps/site'),
    cacheDir: env.SITE_CACHE_DIR ?? path.join(dataDir, 'site-cache'),
    previewDir: env.SITE_PREVIEW_DIR ?? path.join(dataDir, 'site-preview'),
  };
}
