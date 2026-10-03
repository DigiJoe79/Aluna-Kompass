import { describe, expect, it } from 'vitest';
import { siteConnectionSummary } from '../src/pipeline/connection';

const can = (files: string[]) => (f: string) => files.includes(f);

describe('siteConnectionSummary', () => {
  it('reads a key target and never returns the secret', () => {
    const s = siteConnectionSummary(
      { SITE_PUBLIC_URL: 'https://beispiel.invalid', SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web', SITE_DEPLOY_KEY_FILE: '/run/k' },
      can(['/run/k']),
    );
    expect(s).toEqual({ publicUrl: 'https://beispiel.invalid', staging: false, target: { host: 'h', user: 'u', path: '/web' }, auth: 'key', secret: 'set', ready: true });
    expect(JSON.stringify(s)).not.toContain('/run/k');
  });

  it('names a missing and an unreadable secret', () => {
    expect(siteConnectionSummary({ SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web' }, can([]))).toMatchObject({ auth: 'missing', secret: 'missing', ready: false });
    expect(
      siteConnectionSummary({ SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web', SITE_DEPLOY_PASSWORD_FILE: '/run/p' }, can([])),
    ).toMatchObject({ auth: 'password', secret: 'unreadable', ready: false });
  });

  it('treats an empty host as a local directory and no path as not configured', () => {
    expect(siteConnectionSummary({ SITE_DEPLOY_HOST: '', SITE_DEPLOY_USER: '', SITE_DEPLOY_PATH: '/tmp/ziel', SITE_STAGING: '1' }, can([]))).toMatchObject({
      auth: 'local',
      secret: null,
      ready: true,
      staging: true,
    });
    expect(siteConnectionSummary({}, can([]))).toMatchObject({ target: null, ready: false });
  });
});
