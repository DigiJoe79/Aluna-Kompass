import { describe, expect, it } from 'vitest';
import { bannerFor } from '@/lib/env-banner';

describe('bannerFor', () => {
  it('is absent in production', () => {
    expect(bannerFor('production', { lastImportAt: null, migrationCount: 3 })).toBeNull();
  });
  it('labels test and development', () => {
    expect(bannerFor('test', { lastImportAt: '2026-09-02T09:00:00.000Z', migrationCount: 3 })).toEqual({ kind: 'test', label: 'TESTUMGEBUNG' });
    expect(bannerFor('development', { lastImportAt: null, migrationCount: 3 })).toEqual({ kind: 'development', label: 'ENTWICKLUNG' });
  });
});
