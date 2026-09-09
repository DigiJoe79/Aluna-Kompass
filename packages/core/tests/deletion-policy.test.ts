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
    for (const entity of ['user', 'role', 'setting', 'auditEntry', 'document', 'module', 'project']) {
      const rule = DELETION_POLICY.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(false);
    }
  });
});
