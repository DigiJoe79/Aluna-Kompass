import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';

const finance = defineModule({
  key: 'finance',
  version: '0.0.1',
  permissions: ['finance.view', 'finance.edit'],
  settings: [{ key: 'finance.reserveCapPercent', schema: z.number().min(0).max(100), default: 3 }],
});

describe('module registry', () => {
  it('collects permissions and settings from all manifests', () => {
    const registry = createRegistry([coreModule, finance]);
    expect(registry.permissionKeys.has('users.manage')).toBe(true);
    expect(registry.permissionKeys.has('finance.edit')).toBe(true);
    expect(registry.settingDefinitions.get('finance.reserveCapPercent')?.default).toBe(3);
    expect(registry.module('finance')?.version).toBe('0.0.1');
    expect(registry.module('nope')).toBeUndefined();
  });

  it('rejects duplicate module keys and duplicate permission keys', () => {
    expect(() => createRegistry([coreModule, coreModule])).toThrow(/duplicate module/);
    const clash = defineModule({ key: 'other', version: '1', permissions: ['users.manage'] });
    expect(() => createRegistry([coreModule, clash])).toThrow(/duplicate permission/);
  });

  it('rejects duplicate template keys, but allows two templates to share a document type', () => {
    const letter = (key: string, type: string) => ({
      key,
      type,
      base: 'a4-plain',
      schema: z.any(),
      build: () => ({ slots: { kind: 'plain' as const }, body: { markdown: '' } }),
    });
    expect(createRegistry([coreModule], { coreTemplates: [letter('a-letter', 'letter'), letter('b-letter', 'letter')] }).documentTemplates.size).toBe(2);
    expect(() => createRegistry([coreModule], { coreTemplates: [letter('a-letter', 'letter'), letter('a-letter', 'other')] })).toThrow(/duplicate document template/);
  });

  it('defineModule validates key and permission formats', () => {
    expect(() => defineModule({ key: 'Bad Key', version: '1', permissions: [] })).toThrow(/module key/);
    expect(() => defineModule({ key: 'x', version: '1', permissions: ['nodot'] })).toThrow(/permission key/);
  });
});
