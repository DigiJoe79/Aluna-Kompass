import { accessSync, constants } from 'node:fs';
import { readSiteEnv } from './env';

export interface SiteConnectionSummary {
  publicUrl: string | null;
  staging: boolean;
  /** Host `''` heißt: lokales Verzeichnis. */
  target: { host: string; user: string; path: string } | null;
  auth: 'local' | 'key' | 'password' | 'missing';
  /** Ob die Schlüssel- oder Passwortdatei da und lesbar ist; der Inhalt verlässt diese Funktion nie. */
  secret: 'set' | 'missing' | 'unreadable' | null;
  ready: boolean;
}

const readableFile = (file: string): boolean => {
  try {
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Was die Umgebung über das Publish-Ziel sagt, ohne Geheimnis: nur ob die
 * Datei gesetzt und lesbar ist. Kein Dienst — ein Blick in die Umgebung; das
 * Recht prüft die Seite.
 */
export function siteConnectionSummary(
  env: Record<string, string | undefined> = process.env,
  readable: (file: string) => boolean = readableFile,
): SiteConnectionSummary {
  const site = readSiteEnv(env);
  const host = env.SITE_DEPLOY_HOST;
  const target =
    host !== undefined && env.SITE_DEPLOY_USER !== undefined && env.SITE_DEPLOY_PATH
      ? { host, user: env.SITE_DEPLOY_USER, path: env.SITE_DEPLOY_PATH }
      : null;
  let auth: SiteConnectionSummary['auth'] = 'missing';
  let secretFile: string | null = null;
  if (target && !target.host) auth = 'local';
  else if (env.SITE_DEPLOY_KEY_FILE) [auth, secretFile] = ['key', env.SITE_DEPLOY_KEY_FILE];
  else if (env.SITE_DEPLOY_PASSWORD_FILE) [auth, secretFile] = ['password', env.SITE_DEPLOY_PASSWORD_FILE];
  const secret: SiteConnectionSummary['secret'] = auth === 'local' ? null : secretFile === null ? 'missing' : readable(secretFile) ? 'set' : 'unreadable';
  return {
    publicUrl: site.publicUrl,
    staging: site.staging,
    target,
    auth,
    secret,
    ready: site.deploy !== null && secret !== 'unreadable',
  };
}
