import { describe, expect, it } from 'vitest';
import { DELETION_POLICY } from '../src/deletion-policy';

describe('deletion policy', () => {
  it('has no duplicate entities', () => {
    const seen = new Set<string>();
    for (const rule of DELETION_POLICY) {
      expect(seen.has(rule.entity), `doppelt: ${rule.entity}`).toBe(false);
      seen.add(rule.entity);
    }
  });

  it('deletable rules carry a guard and a well-formed audit action, non-deletable carry neither', () => {
    for (const rule of DELETION_POLICY) {
      if (rule.deletable) {
        expect(rule.guard, rule.entity).toBeTruthy();
        expect(rule.auditAction ?? '', rule.entity).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      } else {
        expect(rule.guard, rule.entity).toBeUndefined();
        expect(rule.auditAction, rule.entity).toBeUndefined();
      }
    }
  });

  it('locks the accountability core as not deletable', () => {
    for (const entity of ['user', 'role', 'setting', 'auditEntry', 'module', 'project']) {
      const rule = DELETION_POLICY.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(false);
    }
  });

  it('allows document deletion only after retention expiration with audit action', () => {
    const rule = DELETION_POLICY.find((r) => r.entity === 'document');
    expect(rule).toBeDefined();
    expect(rule!.deletable).toBe(true);
    expect(rule!.retentionClass).toBe('statutory10Y');
    expect(rule!.auditAction).toBe('dms.delete');
  });
});
