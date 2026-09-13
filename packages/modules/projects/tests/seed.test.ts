import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projects } from '../src/schema';
import { seedProjects } from '../src/seed';

describe('seedProjects', () => {
  it('seeds example projects with a published one, links included, and is idempotent', async () => {
    // Die Beispiele tragen Deutsch und Englisch; die Installation muss beide führen.
    const deps = createTestDeps({ locales: ['de', 'en'] });
    const ctx = ctxWith(['projects.manage', 'projects.view'], insertUser(deps, {}));
    await seedProjects(deps, ctx);
    const rows = deps.db.select().from(projects).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.isPublished)).toBe(true);
    expect(rows.some((r) => !r.isPublished)).toBe(true);
    expect(rows.some((r) => r.status === 'completed')).toBe(true);
    expect(rows.some((r) => (r.externalLinks as unknown[]).length > 0)).toBe(true);
    await seedProjects(deps, ctx);
    expect(deps.db.select().from(projects).all().length).toBe(rows.length);
  });

  it('leaves one project summary untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ locales: ['de', 'en'] });
    const ctx = ctxWith(['projects.manage', 'projects.view'], insertUser(deps, {}));
    await seedProjects(deps, ctx);
    const rows = deps.db.select().from(projects).all();
    // `noUncheckedIndexedAccess` macht Record-Zugriffe optional — Helfer statt Cast-Wiederholung.
    const locale = (summary: unknown, code: string): string => (summary as Record<string, string | undefined>)[code] ?? '';
    const gap = rows.filter((p) => locale(p.summary, 'de').length > 0 && locale(p.summary, 'en').length === 0);
    expect(gap.map((p) => p.slug)).toEqual(['auslauf-am-heim']);
  });
});
