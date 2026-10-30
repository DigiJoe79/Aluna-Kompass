import { coreModule, defineModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { CORE_HELP, helpDocFor, helpEntries } from '@/lib/help';

const dms = defineModule({
  key: 'dms',
  version: '0.1.0',
  permissions: ['dms.view'],
  navigation: [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: 'dms.view' }],
  help: [
    { href: '/dms', doc: 'akte/dokumente-und-ordner' },
    { href: '/dms/receive', doc: 'akte/post-ablegen' },
  ],
});

describe('helpDocFor', () => {
  const entries = helpEntries([coreModule, dms], new Set(['core', 'dms']));

  it('prefers the longest matching route and falls back along the path', () => {
    expect(helpDocFor(entries, '/dms/receive')).toBe('akte/post-ablegen');
    expect(helpDocFor(entries, '/dms/01JABC')).toBe('akte/dokumente-und-ordner');
    expect(helpDocFor(entries, '/dmsx')).toBeNull();
  });

  it('knows the core pages and the home page', () => {
    expect(helpDocFor(entries, '/')).toBe('startseite');
    expect(helpDocFor(entries, '/admin/themes')).toBe('einstellungen/themes');
    expect(helpDocFor(entries, '/admin/media')).toBe('mediathek');
  });

  it('contributes nothing for a module that is switched off, and nothing on the help pages', () => {
    const off = helpEntries([coreModule, dms], new Set(['core']));
    expect(helpDocFor(off, '/dms/receive')).toBeNull();
    expect(off).toEqual(CORE_HELP);
    expect(helpDocFor(entries, '/help/akte/post-ablegen')).toBeNull();
    expect(helpDocFor(entries, '/help')).toBeNull();
  });
});

describe('helpDocFor with a pattern (Plan U1 Task 3)', () => {
  const governance = defineModule({
    key: 'governance',
    version: '0.1.0',
    permissions: ['governance.read'],
    help: [
      { href: '/governance/meetings/*/live', doc: 'gremien/mitlauf' },
      { href: '/governance/meetings', doc: 'gremien/sitzungen' },
    ],
  });
  const entries = helpEntries([coreModule, governance], new Set(['core', 'governance']));

  it('the live route wins for the workspace, not for the meeting itself', () => {
    expect(helpDocFor(entries, '/governance/meetings/01J/live')).toBe('gremien/mitlauf');
    expect(helpDocFor(entries, '/governance/meetings/01J')).toBe('gremien/sitzungen');
  });
});
