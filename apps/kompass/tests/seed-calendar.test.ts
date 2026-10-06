import { coreModule, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { contacts } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { financeEntries, financeFiscalYears, financeImportRuns, freeReserveCapOverview, SEED_STORY_LAST_DAY, seedStoryYear } from '@kompass/module-finance';
import { beforeAll, describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Der Entwicklungs-Seed an jedem Kalendertag (Plan 2026-10-06-seed-kalender). Bis 0.2.6 lief er nur von Ende
 * August bis Silvester: Die Finanzgeschichte buchte im laufenden Jahr und auf festen 2026-Daten über Dienste, die
 * keine Zukunft und kein abgeschlossenes Jahr annehmen — ab dem 01.01.2027 wären der E2E-Reset und damit
 * `pnpm verify` und die CI rot gewesen. Gefahren wird, was `pnpm seed`, `dev:reset` und der E2E-Reset fahren:
 * Kern und alle Module über `seedDevelopment`, nur ohne Webseiten-Template (in-memory, die Webseite prüft kein Datum).
 */
const at = (day: string) => `${day}T10:00:00.000Z`;
const seedDeps = (day: string) => createTestDeps({ now: at(day), manifests: [coreModule, ...installedModules], env: 'development' });
type SeedDeps = ReturnType<typeof seedDeps>;

const counts = (deps: SeedDeps) => ({
  entries: deps.db.select().from(financeEntries).all().length,
  documents: deps.db.select().from(documents).all().length,
  contacts: deps.db.select().from(contacts).all().length,
});
const fiscalYears = (deps: SeedDeps) => deps.db.select().from(financeFiscalYears).all().map((y) => y.designation).sort();

describe('the development seed on any calendar day', () => {
  let baseline: ReturnType<typeof counts>;
  beforeAll(async () => {
    const deps = seedDeps('2026-10-06');
    await seedDevelopment(deps);
    baseline = counts(deps);
  }, 30_000);

  it.each(['2026-03-01', '2026-10-06', '2027-01-02', '2027-03-01', '2027-08-31', '2027-12-31', '2028-02-29'])(
    'runs on %s, and a second run adds nothing',
    async (day) => {
      const deps = seedDeps(day);
      await seedDevelopment(deps);
      const first = counts(deps);
      await seedDevelopment(deps);
      expect(counts(deps)).toEqual(first);

      // Vorjahr (abgeschlossen), Stichjahr und das laufende Jahr — in dem die Dienste „heute“ buchen.
      const story = seedStoryYear(day);
      expect(fiscalYears(deps)).toEqual([...new Set([story - 1, story, Number(day.slice(0, 4))])].map(String));
      expect(deps.db.select().from(financeEntries).all().filter((e) => e.entryDate > day).map((e) => e.text)).toEqual([]);
      const periodEnds = deps.db.select().from(financeImportRuns).all().flatMap((r) => (r.periodTo ? [r.periodTo] : [])).sort();
      expect(periodEnds.at(-1)! <= day).toBe(true);
      // Der späteste Geschichtstag ist das Ende des August-Auszugs — genau dort wechselt das Stichjahr.
      if (day.slice(5) === SEED_STORY_LAST_DAY) expect(periodEnds.at(-1)).toBe(day);
      // Vor dem 31.08.2026 fiele das Stichjahr auf 2025, für das die ausgelieferten Rechtswerte fehlen (ab 2026,
      // `ledger/dated-series.ts`) — ohne Höchstbetrag keine freie Rücklage, ein Dokument weniger. Dieser Tag kehrt
      // nicht wieder; ab da erzählt der Seed an jedem Tag dieselbe Geschichte.
      if (day >= '2026-08-31') expect(first).toEqual(baseline);
    },
    30_000,
  );

  it.each([
    ['2026-12-31', '2027-01-02'],
    ['2027-08-30', '2027-09-01'],
  ])('stays in the story of its first run when the second one falls on %s → %s', async (firstDay, secondDay) => {
    const deps = seedDeps(firstDay);
    await seedDevelopment(deps);
    const first = counts(deps);
    const years = fiscalYears(deps);
    deps.clock.set(at(secondDay));
    await seedDevelopment(deps);
    expect(counts(deps)).toEqual(first);
    expect(fiscalYears(deps)).toEqual(years);
  }, 30_000);

  // Befund 4 (0.2.7): Von Januar bis August liegt das Stichjahr im noch offenen Vorjahr — die Rücklagenseite zeigt
  // es „vorläufig“ vor dem laufenden Jahr und schlägt es für eine Zuführung vor; ab dem 31.08. ist das Vorjahr zu.
  it.each(['2026-10-06', '2027-01-02', '2027-03-01', '2027-09-15'])(
    'shows the free reserve cap of the story year on %s, provisional while it lies before this year',
    async (day) => {
      const deps = seedDeps(day);
      await seedDevelopment(deps);
      const overview = unwrap(await freeReserveCapOverview(deps, ctxWith(['finance.overview']), {}));
      const story = String(seedStoryYear(day));
      const current = day.slice(0, 4);
      expect(overview.years.map((y) => [y.designation, y.provisional])).toEqual(story === current ? [[story, false]] : [[story, true], [current, false]]);
      const storyYear = overview.years.find((y) => y.designation === story)!;
      expect(overview.defaultFiscalYearId).toBe(storyYear.fiscalYearId);
      expect(storyYear.usedCents).toBeGreaterThan(0); // die Zuführung des Seeds, 85 % des Höchstbetrags
    },
    30_000,
  );
});
