import { describe, expect, it } from 'vitest';
import { astroEnv } from '../src';

describe('astroEnv', () => {
  const parent = { PATH: '/usr/bin', HOME: '/home/node', TMPDIR: '/tmp', TZ: 'Europe/Berlin', LANG: 'de_DE.UTF-8', LC_ALL: 'C.UTF-8',
    SESSION_SECRET: 'geheim', SITE_DEPLOY_PASSWORD_FILE: '/secret/site.pw', DATA_PATH: '/data', E2E_RESET_TOKEN: 'x', NODE_ENV: 'development' };
  it('passes only the allowed variables and the template variables', () => {
    expect(astroEnv(parent, { contentDir: '/tmp/job', publicUrl: 'https://example.org', staging: true })).toEqual({
      PATH: '/usr/bin', HOME: '/home/node', TMPDIR: '/tmp', TZ: 'Europe/Berlin', LANG: 'de_DE.UTF-8', LC_ALL: 'C.UTF-8',
      NODE_ENV: 'production', SITE_CONTENT_DIR: '/tmp/job', SITE_PUBLIC_URL: 'https://example.org', SITE_STAGING: '1',
      FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb',
    });
  });
  it('leaves out what the parent does not have', () => {
    expect(Object.keys(astroEnv({ PATH: '/bin' }, { contentDir: 'c', publicUrl: 'u', staging: false }))).not.toContain('HOME');
  });
});
