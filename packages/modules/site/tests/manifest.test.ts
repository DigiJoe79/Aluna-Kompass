import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { siteModule } from '../src';

describe('site module', () => {
  it('registers its permissions and navigation without clashes', () => {
    const registry = createRegistry([coreModule, siteModule]);
    expect(siteModule.key).toBe('site');
    expect(registry.permissionKeys.has('site.manage')).toBe(true);
    expect(registry.permissionKeys.has('site.publish')).toBe(true);
    expect(siteModule.navigation?.some((n) => n.href === '/site/template')).toBe(true);
  });
});
