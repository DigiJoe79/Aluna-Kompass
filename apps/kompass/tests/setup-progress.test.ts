import { describe, expect, it } from 'vitest';
import { computeSetupProgress, REQUIRED_SETTINGS } from '@/lib/setup-progress';

describe('computeSetupProgress', () => {
  it('counts filled required settings and lists the missing ones', () => {
    const settings: Record<string, unknown> = { 'organization.name': 'X', 'organization.street': 'S', 'organization.postalCode': '1', 'organization.city': 'C', 'organization.exemptionNoticeType': 'none' };
    const p = computeSetupProgress({ settings, roleCount: 1, modules: [{ key: 'core', enabled: true }, { key: 'finance', enabled: false }] });
    expect(p.settings).toEqual({ done: 4, total: REQUIRED_SETTINGS.length, missing: ['organization.registerCourt', 'organization.registerNumber', 'organization.taxNumber', 'organization.taxOffice', 'organization.exemptionNoticeType', 'organization.exemptionNoticeDate'] });
    expect(p.roles).toEqual({ done: 1, total: 3 });
    expect(p.modules).toEqual({ done: 0, total: 1 });
  });
  it('caps roles at the target and ignores core in modules', () => {
    const p = computeSetupProgress({ settings: {}, roleCount: 5, modules: [{ key: 'core', enabled: true }] });
    expect(p.roles).toEqual({ done: 3, total: 3 });
    expect(p.modules).toEqual({ done: 0, total: 0 });
  });
});
