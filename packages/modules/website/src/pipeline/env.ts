import path from 'node:path';

/** Wie sich Kompass beim Zielserver anmeldet. */
export type DeployAuth =
  | { kind: 'none' }
  | { kind: 'key'; keyFile: string }
  | { kind: 'password'; passwordFile: string };

export interface DeployTarget {
  host: string;
  user: string;
  path: string;
  auth: DeployAuth;
}

export interface SiteEnv {
  publicUrl: string | null;
  staging: boolean;
  deploy: DeployTarget | null;
  siteDir: string;
  cacheDir: string;
  previewDir: string;
}

function readAuth(env: Record<string, string | undefined>, host: string): DeployAuth | null {
  // Ohne entfernten Host wird in ein lokales Verzeichnis geschrieben (Tests, E2E).
  if (!host) return { kind: 'none' };
  if (env.SITE_DEPLOY_KEY_FILE) return { kind: 'key', keyFile: env.SITE_DEPLOY_KEY_FILE };
  if (env.SITE_DEPLOY_PASSWORD_FILE) return { kind: 'password', passwordFile: env.SITE_DEPLOY_PASSWORD_FILE };
  return null;
}

export function readSiteEnv(env: Record<string, string | undefined> = process.env): SiteEnv {
  const dataDir = path.dirname(env.DATABASE_PATH ?? './data/kompass.db');
  const host = env.SITE_DEPLOY_HOST ?? '';
  const auth = readAuth(env, host);
  const deploy =
    env.SITE_DEPLOY_HOST !== undefined && env.SITE_DEPLOY_USER !== undefined && env.SITE_DEPLOY_PATH && auth
      ? { host, user: env.SITE_DEPLOY_USER, path: env.SITE_DEPLOY_PATH, auth }
      : null;
  return {
    publicUrl: env.SITE_PUBLIC_URL ?? null,
    staging: env.SITE_STAGING === '1',
    deploy,
    // Absolut auflösen: der Site-Build läuft als Kindprozess mit siteDir als
    // Arbeitsverzeichnis, relative Pfade zeigten dort sonst woanders hin.
    siteDir: path.resolve(env.SITE_DIR ?? path.resolve(process.cwd(), '../../apps/site')),
    cacheDir: path.resolve(env.SITE_CACHE_DIR ?? path.join(dataDir, 'site-cache')),
    previewDir: path.resolve(env.SITE_PREVIEW_DIR ?? path.join(dataDir, 'site-preview')),
  };
}
