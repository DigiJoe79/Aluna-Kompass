import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { CORE_DELETION_RULES, deletionPolicy, type DeletionRule } from '../src/deletion-policy';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';

const demo = (rules: DeletionRule[]) => defineModule({ key: 'demo', version: '1', permissions: [], deletionRules: rules });

describe('core deletion rules', () => {
  it('has no duplicate entities', () => {
    const seen = new Set<string>();
    for (const rule of CORE_DELETION_RULES) {
      expect(seen.has(rule.entity), `doppelt: ${rule.entity}`).toBe(false);
      seen.add(rule.entity);
    }
  });

  it('locks the accountability core as not deletable', () => {
    for (const entity of ['user', 'role', 'setting', 'auditEntry', 'module']) {
      const rule = CORE_DELETION_RULES.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(false);
    }
  });

  it('names the working material of the core as deletable, with its audit action', () => {
    const expected: Record<string, string> = {
      followUp: 'followUps.delete',
      mediaAsset: 'media.delete',
      mediaFolder: 'media.folder.delete',
      theme: 'themes.delete',
    };
    for (const [entity, action] of Object.entries(expected)) {
      const rule = CORE_DELETION_RULES.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(true);
      expect(rule!.auditAction, entity).toBe(action);
    }
  });

  it('knows no entity of any module', () => {
    // Projekte, Tiere, Akte, Kontakte, Webseite: deren Regeln stehen an ihrem Manifest.
    const foreign = CORE_DELETION_RULES.filter((r) => /^(project|animal|document|contact|site)/.test(r.entity));
    expect(foreign.map((r) => r.entity)).toEqual([]);
  });

  it('is what the core manifest declares', () => {
    expect(coreModule.deletionRules).toBe(CORE_DELETION_RULES);
  });
});

describe('deletion rules at the manifest', () => {
  it('deletable rules carry a guard and a well-formed audit action', () => {
    expect(() => demo([{ entity: 'x', deletable: true, reason: 'r', auditAction: 'x.delete' }])).toThrow(/guard/);
    expect(() => demo([{ entity: 'x', deletable: true, reason: 'r', guard: 'keiner' }])).toThrow(/audit action/);
    // Dieselbe Form wie ein Permission-Key: camelCase je Abschnitt, damit `followUps.delete` besteht.
    expect(() => demo([{ entity: 'x', deletable: true, reason: 'r', guard: 'keiner', auditAction: 'x_delete' }])).toThrow(/audit action/);
    expect(() => demo([{ entity: 'x', deletable: true, reason: 'r', guard: 'keiner', auditAction: 'x.sub.delete' }])).not.toThrow();
  });

  it('non-deletable rules carry neither guard nor audit action', () => {
    expect(() => demo([{ entity: 'x', deletable: false, reason: 'r', guard: 'keiner' }])).toThrow(/guard/);
    expect(() => demo([{ entity: 'x', deletable: false, reason: 'r', auditAction: 'x.delete' }])).toThrow(/audit action/);
    expect(() => demo([{ entity: 'x', deletable: false, reason: 'r' }])).not.toThrow();
  });

  it('rejects an entity ruled twice within one module', () => {
    expect(() => demo([{ entity: 'x', deletable: false, reason: 'a' }, { entity: 'x', deletable: false, reason: 'b' }])).toThrow(/duplicate deletion rule/);
  });

  it('rejects an entity ruled by two modules', () => {
    const clash = defineModule({ key: 'other', version: '1', permissions: [], deletionRules: [{ entity: 'user', deletable: false, reason: 'meins' }] });
    expect(() => createRegistry([coreModule, clash])).toThrow(/duplicate deletion rule: user/);
  });

  it('deletionPolicy joins the core with every installed module', () => {
    const finance = defineModule({ key: 'finance', version: '1', permissions: [], deletionRules: [{ entity: 'booking', deletable: false, reason: 'Beleg' }] });
    const registry = createRegistry([coreModule, finance]);
    const policy = deletionPolicy(registry);
    expect(policy.find((r) => r.entity === 'booking')?.deletable).toBe(false);
    expect(policy.find((r) => r.entity === 'user')).toBeDefined();
    expect(policy.length).toBe(CORE_DELETION_RULES.length + 1);
  });
});
