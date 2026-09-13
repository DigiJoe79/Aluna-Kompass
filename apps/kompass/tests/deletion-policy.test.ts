import { coreModule, createRegistry, deletionPolicy } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Die Löschpolitik dieser Installation: der Kern plus jedes installierte
 * Modul. Jedes Modul führt seine eigenen Entitäten; hier wird geprüft, dass
 * die Summe stimmt und die festgezurrten Grenzfälle aus `AGENTS.md` stehen.
 */
const policy = deletionPolicy(createRegistry([coreModule, ...installedModules]));
const rule = (entity: string) => policy.find((r) => r.entity === entity);

describe('deletion policy of this installation', () => {
  it('rules every entity exactly once', () => {
    const entities = policy.map((r) => r.entity);
    expect(new Set(entities).size).toBe(entities.length);
  });

  it('keeps projects, animals and the publish history until their pillar decides otherwise', () => {
    for (const entity of ['project', 'animal', 'sitePublish']) {
      expect(rule(entity), entity).toBeDefined();
      expect(rule(entity)!.deletable, entity).toBe(false);
    }
  });

  it('allows document deletion only after retention expiration, with audit action', () => {
    expect(rule('document')?.deletable).toBe(true);
    expect(rule('document')?.retentionClass).toBe('statutory10Y');
    expect(rule('document')?.auditAction).toBe('dms.delete');
  });

  it('names the working material of the file as deletable, with its audit action', () => {
    const expected: Record<string, string> = {
      documentDraft: 'dms.draft.delete',
      documentFolder: 'dms.folder.delete',
      documentLink: 'dms.unlink',
      documentRule: 'dms.rule.delete',
      documentRelation: 'dms.unrelate',
      documentNote: 'dms.note.delete',
      documentSnippet: 'dms.snippet.delete',
      siteEntry: 'site.entry.delete',
      contact: 'contacts.delete',
    };
    for (const [entity, action] of Object.entries(expected)) {
      expect(rule(entity)?.deletable, entity).toBe(true);
      expect(rule(entity)?.auditAction, entity).toBe(action);
    }
  });

  it('lets each module rule only entities of its own', () => {
    const owner: Record<string, string> = {
      project: 'projects',
      animal: 'animals',
      contact: 'contacts',
      sitePublish: 'site',
      siteEntry: 'site',
      document: 'dms',
    };
    for (const m of installedModules) {
      for (const r of m.deletionRules ?? []) {
        if (owner[r.entity]) expect(m.key, r.entity).toBe(owner[r.entity]);
      }
    }
  });
});
