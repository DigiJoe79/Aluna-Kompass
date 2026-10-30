import { coreModule, schema, seedDevelopment, seedStoryYear, todayIn, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { financeFiscalYears, runFinanceReport } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Die Jahresrechnung des Vorjahres — festgeschrieben, abgezeichnet, bereitgestellt; das Bild `fin-jahresrechnung` der
 * Pipeline — erzählt eine plausible Kostenstruktur: Die Satzungsarbeit an publizierten Projekten überwiegt, Werbung und
 * Verwaltung sind klein. Dann zeigt der Bildschirm keinen Hinweis „Posten über 25 %“ (`screen.over25`).
 */
describe('Jahresrechnung des Vorjahres im Entwicklungsseed', () => {
  it('hat keine Sammelposten über 25 % und mehr Satzungsarbeit als Werbung und Verwaltung', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const admin = deps.db.select().from(schema.users).all().find((u) => u.email === 'admin@kompass.local')!;
    const all = ctxWith([...deps.registry.permissionKeys], admin.id);
    const previous = String(seedStoryYear(todayIn(deps)) - 1);
    const year = deps.db.select().from(financeFiscalYears).all().find((y) => y.designation === previous)!;
    const data = unwrap(await runFinanceReport(deps, all, { report: 'annualAccounts', params: { fiscalYearId: year.id } })).data as {
      screen: { over25: { key: string }[] };
      expense: { program: { total: { cents: number } }; fundraising: { cents: number }; administration: { cents: number } };
    };
    expect(data.screen.over25.map((o) => o.key)).toEqual([]);
    expect(data.expense.program.total.cents).toBeGreaterThan(2 * (data.expense.fundraising.cents + data.expense.administration.cents));
  }, 120_000);
});
