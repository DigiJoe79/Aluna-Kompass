import { coreModule, schema, seedDevelopment, unwrap, type TranslationGapList, type TranslationWriteReport } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

const tool = (name: string) => coreMcpTools.find((t) => t.name === name)!;
const listGaps = async (...args: Parameters<ReturnType<typeof tool>['handler']>) => unwrap(await tool('translations_list_gaps').handler(...args)) as TranslationGapList;
const setTranslations = async (...args: Parameters<ReturnType<typeof tool>['handler']>) => unwrap(await tool('translations_set').handler(...args)) as TranslationWriteReport;

describe('translations over MCP, end to end', () => {
  it('lists the seeded gaps of every module and closes them one record at a time', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const all = ctxWith(['animals.view', 'animals.manage', 'projects.view', 'projects.manage', 'site.view', 'site.manage']);

    const listed = await listGaps(deps, all, {});
    const byType = Object.groupBy(listed.gaps, (g) => g.entityType);
    expect(Object.keys(byType).sort()).toEqual(['animal', 'project']);
    expect(byType.animal!.map((g) => g.field).sort()).toEqual(['body', 'summary']);
    expect(byType.project!.map((g) => g.field)).toEqual(['summary']);
    expect(listed.gaps.every((g) => g.source.locale === 'de' && String(g.source.text).length > 0 && g.href.startsWith('/'))).toBe(true);

    const auditBefore = deps.db.select().from(schema.auditLog).all().length;
    const written = await setTranslations(deps, all, { items: listed.gaps.map((g) => ({ entityType: g.entityType, id: g.id, field: g.field, locale: g.locale, text: `EN: ${g.source.text}` })) });
    expect(written).toEqual({ applied: 3, failed: [] });
    // Zwei Datensätze, zwei Audit-Einträge — die zwei Felder des Tiers gehen in einem Update.
    expect(deps.db.select().from(schema.auditLog).all().length - auditBefore).toBe(2);
    expect((await listGaps(deps, all, {})).gaps).toEqual([]);
  });

  it('names the modules a caller may not read', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const onlyProjects = await listGaps(deps, ctxWith(['projects.view']), {});
    expect(onlyProjects.omitted.sort()).toEqual(['animals', 'site']);
    expect(onlyProjects.gaps.map((g) => g.entityType)).toEqual(['project']);
  });
});
