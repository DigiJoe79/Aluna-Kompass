import { collectRetentionDue, coreModule, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { financeEntries, financeFiscalYears, financeImportRuns, freeReserveCapOverview, listPledges, SEED_STORY_LAST_DAY, seedStoryYear } from '@kompass/module-finance';
import { listFees } from '@kompass/module-members';
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

/**
 * Zeilen je Tabelle, alle Tabellen (wie `futureValues`), auch das Protokoll: Ein zweiter Lauf legt in keinem Modul
 * etwas an und schreibt keinen Eintrag, weil er nichts ändert.
 */
const tableNames = (deps: SeedDeps) =>
  (deps.sqlite.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name").all() as { name: string }[])
    .map((t) => t.name);
const counts = (deps: SeedDeps) =>
  Object.fromEntries(tableNames(deps).map((table) => [table, (deps.sqlite.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n]));
/**
 * Was mit dem Kalenderjahr wächst, nicht mit der Geschichte: das laufende Geschäftsjahr, seine Nummernkreise und
 * die Protokolleinträge, die beides anlegen.
 */
const YEAR_BOUND = ['finance_fiscal_years', 'document_counters', 'finance_purpose_transfer_counters', 'audit_log'];
const storyCounts = (all: ReturnType<typeof counts>) => Object.fromEntries(Object.entries(all).filter(([table]) => !YEAR_BOUND.includes(table)));
/**
 * Datierte Seed-Daten, die in der Zukunft liegen dürfen (0.2.8, aus 0.2.7 Punkt 5). Bis dahin prüfte der Test
 * „nichts in der Zukunft“ nur an Buchungen und Auszugsenden; jetzt jede Spalte jeder Tabelle, deren Wert mit
 * einem ISO-Tag beginnt — Belege, Bestätigungen, Bescheide, Dokumentdaten der Akte, Rollen, Protokoll,
 * Zeitstempel. Ausgenommen ist nur, was seiner Natur nach vorausweist: eine Frist, ein Ablauf, ein Ende.
 */
const FUTURE_ALLOWED: Readonly<Record<string, string>> = {
  'follow_ups.due_at': 'Wiedervorlage: Sie liegt gewollt in der Zukunft.',
  'sessions.expires_at': 'Ablauf der Sitzung.',
  'users.locked_until': 'Ende einer Anmeldesperre.',
  'finance_fiscal_years.ends_on': 'Das laufende Geschäftsjahr endet nach heute.',
  'finance_open_items.due_on': 'Fälligkeit eines offenen Postens.',
  'finance_partner_notices.valid_until': 'Ein Bescheid des Partners gilt über heute hinaus.',
  'finance_partner_payments.proof_due_on': 'Frist für den Verwendungsnachweis.',
  'finance_signers.valid_to': 'Ende einer Zeichnungsberechtigung, darf geplant sein.',
  'contact_roles.until': 'Ende einer Rolle, darf geplant sein.',
  'member_memberships.ends_on': 'Ende einer Mitgliedschaft, darf geplant sein (Austritt zum Jahresende).',
  'finance_dated_values.valid_from': 'Ein Rechtswert darf ab einem künftigen Stichtag gelten.',
  'member_fee_charges.period_start': 'Der Beitragslauf legt das ganze Stichjahr an, auch die Monate nach heute.',
  'member_fee_charges.period_end': 'Ende eines Beitragszeitraums im Stichjahr.',
  'member_fee_charges.due_on': 'Fälligkeit eines Beitrags, wie die des offenen Postens.',
  'member_fee_charges.deferred_to': 'Gestundet bis: eine Frist.',
  'finance_pledges.paused_until': 'Eine Zusage ruht bis zu einem Tag, der nach heute liegen darf (Plan L1).',
};

/**
 * Spalten jeder Tabelle mit ISO-Tag nach `day` oder Zeitstempel nach jetzt, als `tabelle.spalte: spätester Wert`.
 * Eine Minute Spielraum: Bei stehender Testuhr gehen Ladestände (`nextVersion`) Millisekunden vor — das sieht niemand.
 */
function futureValues(deps: SeedDeps, day: string): string[] {
  const now = new Date(deps.clock.now().getTime() + 60_000).toISOString();
  const tables = deps.sqlite.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'").all() as { name: string }[];
  return tables.flatMap(({ name: table }) =>
    (deps.sqlite.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).flatMap(({ name: column }) => {
      if (`${table}.${column}` in FUTURE_ALLOWED) return [];
      const row = deps.sqlite
        .prepare(`select max("${column}") as latest from "${table}" where typeof("${column}") = 'text' and "${column}" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]*' and "${column}" > (case when length("${column}") = 10 then ? else ? end)`)
        .get(day, now) as { latest: string | null };
      return row.latest ? [`${table}.${column}: ${row.latest}`] : [];
    }),
  );
}

/**
 * Was der Seed an Zuständen zeigt, die von „heute“ abhängen: Löschfälliges, ruhende Zusagen, Mitglieder mit
 * überfälligem Beitrag. Solange dasselbe Stichjahr gilt, ist es an jedem Tag dasselbe — bis 0.3.0 kippten am
 * 1. Januar eine gestundete Frist, eine Pause und eine Aufbewahrung (Lauf `scripts/e2e-kalender.sh` vom 2026-10-18).
 */
async function storyState(deps: SeedDeps, day: string) {
  const ctx = ctxWith([...deps.registry.permissionKeys]);
  const fees = unwrap(await listFees(deps, ctx, { year: seedStoryYear(day), limit: 200 })).items;
  const pledges = unwrap(await listPledges(deps, ctx, { limit: 50, offset: 0 })).items;
  return {
    retentionDue: collectRetentionDue(deps).map((d) => `${d.entity} ${d.label}`).sort(),
    pledges: pledges.map((p) => `${p.contactName} ${p.state}`).sort(),
    overdueMembers: [...new Set(fees.filter((f) => f.overdue).map((f) => f.name))].sort(),
  };
}

const fiscalYears = (deps: SeedDeps) => deps.db.select().from(financeFiscalYears).all().map((y) => y.designation).sort();

describe('the development seed on any calendar day', () => {
  let baseline: ReturnType<typeof counts>;
  let baselineState: Awaited<ReturnType<typeof storyState>>;
  beforeAll(async () => {
    const deps = seedDeps('2026-10-06');
    await seedDevelopment(deps);
    baseline = counts(deps);
    baselineState = await storyState(deps, '2026-10-06');
  }, 30_000);

  it.each(['2026-03-01', '2026-10-06', '2027-01-02', '2027-03-01', '2027-08-30', '2027-08-31', '2027-12-31', '2028-02-29'])(
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
      expect(futureValues(deps, day)).toEqual([]);
      const periodEnds = deps.db.select().from(financeImportRuns).all().flatMap((r) => (r.periodTo ? [r.periodTo] : [])).sort();
      expect(periodEnds.at(-1)! <= day).toBe(true);
      // Der späteste Geschichtstag ist das Ende des August-Auszugs — genau dort wechselt das Stichjahr.
      if (day.slice(5) === SEED_STORY_LAST_DAY) expect(periodEnds.at(-1)).toBe(day);
      // Vor dem 31.08.2026 fiele das Stichjahr auf 2025, für das die ausgelieferten Rechtswerte fehlen (ab 2026,
      // `ledger/dated-series.ts`) — ohne Höchstbetrag keine freie Rücklage, ein Dokument weniger. Dieser Tag kehrt
      // nicht wieder; ab da erzählt der Seed an jedem Tag dieselbe Geschichte.
      if (day >= '2026-08-31') {
        expect(storyCounts(first)).toEqual(storyCounts(baseline));
        expect(await storyState(deps, day)).toEqual(baselineState);
      }
    },
    30_000,
  );

  it('names only columns that exist in the exceptions for future dates', () => {
    const deps = seedDeps('2026-10-06');
    const missing = Object.keys(FUTURE_ALLOWED).filter((key) => {
      const [table, column] = key.split('.');
      return !(deps.sqlite.prepare(`pragma table_info("${table}")`).all() as { name: string }[]).some(({ name }) => name === column);
    });
    expect(missing).toEqual([]);
  });

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
