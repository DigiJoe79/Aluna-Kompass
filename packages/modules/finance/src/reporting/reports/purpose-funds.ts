import { type DbOrTx } from '@kompass/core';
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { purposeBalancesAt } from '../../ledger/queries';
import { financeAllocationCorrections, financeAllocationLines, financeEntries, financePurposes } from '../../schema';
import { dayBefore } from '../other-assets';
import type { ReportComputeEnv, ReportDefinition, ReportLinesFilter, ReportParams, ReportRenderContext } from '../types';
import { reportTimeZone, TIME_ZONE_SETTING, zonedDayOf, zonedDayRange } from '../../zoned-days';
import { amountCell, checkYearOrDate, paragraph, reportYearInternal, strongAmountCell, strongCell, table, textCell, yearParamsSchema, type ReportYear } from './common';

/**
 * Zweckmittel (Finanz-Spec § 9.2, Rechenschaft B1 Task 2): je Zweck Vortrag, Korrekturen an Vorjahresbuchungen,
 * Zugang, Verwendung, Umwidmungen und Bestand im Geschäftsjahr. Die Spalten gehen auf; der Bestand ist
 * `purposeBalancesAt(endsOn)`. „Korrekturen“ sind die im Jahr angewandten Zuordnungskorrekturen an Buchungen vor dem
 * Jahr — so gleicht der Vortrag dem Bestand des festgeschriebenen Vorjahresberichts (Entscheidung 3 des Plans).
 */

export interface PurposeFundsRow {
  purposeId: string;
  /** Zustand am Ende des Jahres. */
  state: 'open' | 'fulfilled' | 'dissolved';
  abroad: boolean;
  projectId: string | null;
  carryForwardCents: number;
  correctionsCents: number;
  inflowCents: number;
  usedCents: number;
  transfersInCents: number;
  transfersOutCents: number;
  closingCents: number;
  negative: boolean;
}

export type PurposeFundsTotals = Omit<PurposeFundsRow, 'purposeId' | 'state' | 'abroad' | 'projectId' | 'negative'>;

export interface PurposeFundsReport {
  year: ReportYear;
  purposes: PurposeFundsRow[];
  totals: PurposeFundsTotals;
}

/** Tag eines Zeitstempels in der Zone des Vereins (F-B3); Tage bleiben, wie sie sind. */
const dayOf = (value: string | null, timeZone: string): string | null => (value === null ? null : zonedDayOf(value, timeZone));

/** Wirkung der im Jahr angewandten Korrekturen an Zeilen von Buchungen vor dem Jahr, je Zweck (+ Ziel, − Herkunft). */
function priorLineCorrectionsInternal(db: DbOrTx, year: ReportYear, timeZone: string): Map<string, number> {
  const range = zonedDayRange(year.startsOn, year.endsOn, timeZone);
  const rows = db
    .select({ before: financeAllocationCorrections.before, after: financeAllocationCorrections.after, amountCents: financeAllocationLines.amountCents })
    .from(financeAllocationCorrections)
    .innerJoin(financeAllocationLines, eq(financeAllocationLines.id, financeAllocationCorrections.lineId))
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationCorrections.entryId))
    .where(
      and(
        eq(financeAllocationCorrections.state, 'applied'),
        lt(financeEntries.entryDate, year.startsOn),
        gte(financeAllocationCorrections.approvedAt, range.start),
        lt(financeAllocationCorrections.approvedAt, range.end),
      ),
    )
    .all();
  const effect = new Map<string, number>();
  const add = (purposeId: string | null | undefined, cents: number) => {
    if (purposeId) effect.set(purposeId, (effect.get(purposeId) ?? 0) + cents);
  };
  for (const r of rows) {
    const after = JSON.parse(r.after) as { purposeId?: string | null };
    if (!('purposeId' in after)) continue;
    const before = JSON.parse(r.before) as { purposeId?: string | null };
    add(before.purposeId, -r.amountCents);
    add(after.purposeId, r.amountCents);
  }
  return effect;
}

export function computePurposeFundsReport(db: DbOrTx, params: ReportParams, env?: ReportComputeEnv): PurposeFundsReport {
  const timeZone = reportTimeZone(env);
  const year = reportYearInternal(db, params.fiscalYearId!);
  const opening = new Map(purposeBalancesAt(db, dayBefore(year.startsOn)).map((b) => [b.purposeId, b]));
  const closing = new Map(purposeBalancesAt(db, year.endsOn).map((b) => [b.purposeId, b]));
  const corrections = priorLineCorrectionsInternal(db, year, timeZone);

  const purposes = db
    .select()
    .from(financePurposes)
    .orderBy(asc(financePurposes.createdAt), asc(financePurposes.id))
    .all()
    .flatMap((p): PurposeFundsRow[] => {
      const a = opening.get(p.id)!;
      const e = closing.get(p.id)!;
      const dissolvedOn = dayOf(p.dissolvedAt, timeZone);
      if (dissolvedOn !== null && dissolvedOn < year.startsOn && a.balanceCents === 0 && e.balanceCents === 0) return [];
      // Ein Zweck, den es am Jahresende noch nicht gab, gehört nicht in den Bericht dieses Jahres — sonst änderte jeder
      // neue Zweck den Hash eines freigegebenen Jahres (Designer Runde 6, 260). Mit Bewegung im Jahr (eine Korrektur
      // ordnet eine alte Zeile zu) steht er.
      const createdOn = dayOf(p.createdAt, timeZone)!;
      const moved = e.inflowCents !== a.inflowCents || e.outflowCents !== a.outflowCents || e.transfersInCents !== a.transfersInCents || e.transfersOutCents !== a.transfersOutCents || e.balanceCents !== 0 || a.balanceCents !== 0 || (corrections.get(p.id) ?? 0) !== 0;
      if (createdOn > year.endsOn && !moved) return [];
      const fulfilledOn = dayOf(p.fulfilledAt, timeZone);
      const state: PurposeFundsRow['state'] = dissolvedOn !== null && dissolvedOn <= year.endsOn ? 'dissolved' : fulfilledOn !== null && fulfilledOn <= year.endsOn ? 'fulfilled' : 'open';
      const correctionsCents = corrections.get(p.id) ?? 0;
      // Ein Vortrag, der erst im Jahr gilt (Startbestand eines Zwecks bei Einführung), zählt zum Vortrag, nicht zum Zugang.
      const carryForwardCents = a.balanceCents - correctionsCents + (e.carryForwardCents - a.carryForwardCents);
      return [{
        purposeId: p.id,
        state,
        abroad: p.abroad,
        projectId: p.projectId,
        carryForwardCents,
        correctionsCents,
        inflowCents: e.inflowCents - a.inflowCents,
        usedCents: e.outflowCents - a.outflowCents,
        transfersInCents: e.transfersInCents - a.transfersInCents,
        transfersOutCents: e.transfersOutCents - a.transfersOutCents,
        closingCents: e.balanceCents,
        negative: e.balanceCents < 0,
      }];
    });

  const sum = (pick: (r: PurposeFundsRow) => number) => purposes.reduce((acc, r) => acc + pick(r), 0);
  return {
    year,
    purposes,
    totals: {
      carryForwardCents: sum((r) => r.carryForwardCents),
      correctionsCents: sum((r) => r.correctionsCents),
      inflowCents: sum((r) => r.inflowCents),
      usedCents: sum((r) => r.usedCents),
      transfersInCents: sum((r) => r.transfersInCents),
      transfersOutCents: sum((r) => r.transfersOutCents),
      closingCents: sum((r) => r.closingCents),
    },
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const STATE_TEXT: Record<PurposeFundsRow['state'], string | null> = { open: null, fulfilled: 'erfüllt', dissolved: 'aufgelöst' };

/** Ohne jede Bewegung und ohne Bestand: alle Spalten null. */
const isIdle = (r: PurposeFundsRow) => r.carryForwardCents === 0 && r.correctionsCents === 0 && r.inflowCents === 0 && r.usedCents === 0 && r.transfersInCents === 0 && r.transfersOutCents === 0 && r.closingCents === 0;

export function purposeFundsTypst(data: PurposeFundsReport, ctx: ReportRenderContext): string {
  if (data.purposes.length === 0) return paragraph('Im Geschäftsjahr gibt es keine Zwecke.');
  const withCorrections = data.purposes.some((r) => r.correctionsCents !== 0);
  // Die Köpfe stehen ungetrennt (Designer Runde 7, 260): Die Betragsspalten sind breit genug für „Umwidmungen“, die
  // Namensspalte nimmt den Rest und bricht selbst um; rechtsbündig wie die Beträge.
  // Mindestens 16 px zwischen den Köpfen (Designer Runde 8, 267: „Verwendung“ und „Umwidmungen“ stießen bei 25 mm
  // aneinander): 27 mm je Betrag. Mit der Spalte „Korrekturen“ bleibt es bei 24 mm, sonst fehlte dem Namen der Platz.
  const columns = withCorrections ? '(1fr, 24mm, 24mm, 24mm, 24mm, 24mm, 24mm)' : '(1fr, 27mm, 27mm, 27mm, 27mm, 27mm)';
  const header = ['in €', 'Vortrag', ...(withCorrections ? ['Korrekturen'] : []), 'Zugang', 'Verwendung', 'Umwidmungen', 'Bestand'];
  const cells = (r: PurposeFundsTotals, strong: boolean) => {
    const cell = strong ? strongAmountCell : amountCell;
    return [cell(r.carryForwardCents), ...(withCorrections ? [cell(r.correctionsCents)] : []), cell(r.inflowCents), cell(r.usedCents), cell(r.transfersInCents - r.transfersOutCents), cell(r.closingCents)];
  };
  // Zwecke mit nur Nullen stehen nicht als Zeile, sondern gezählt darunter (Designer Runde 6, 260). Nur Darstellung:
  // Daten und Hash bleiben, wie sie sind.
  const moving = data.purposes.filter((r) => !isIdle(r));
  const idle = data.purposes.length - moving.length;
  if (moving.length === 0) return paragraph(idle === 1 ? 'Der Zweck hat im Geschäftsjahr keine Bewegung.' : `Die ${idle} Zwecke haben im Geschäftsjahr keine Bewegung.`);
  const rows = moving.map((r) => {
    const name = ctx.labels[`purpose.${r.purposeId}`] ?? r.purposeId;
    // „(Ausland)“ nur, wenn der Name es nicht schon sagt.
    const abroad = r.abroad && !/ausland/i.test(name);
    const notes = [abroad ? 'Ausland' : null, STATE_TEXT[r.state], r.negative ? 'im Minus' : null].filter((n): n is string => n !== null);
    return [textCell(notes.length > 0 ? `${name} (${notes.join(', ')})` : name), ...cells(r, false)];
  });
  rows.push([strongCell('Summe'), ...cells(data.totals, true)]);
  const parts = [table(columns, header, rows, { rightHeads: header.map((_, i) => i).slice(1) })];
  if (idle > 0) parts.push(paragraph(idle === 1 ? 'Ein weiterer Zweck ohne Bewegung.' : `Weitere ${idle} Zwecke ohne Bewegung.`));
  if (withCorrections) parts.push(paragraph('Korrekturen: im Geschäftsjahr angewandte Zuordnungskorrekturen an Buchungen früherer Jahre. Der Vortrag entspricht dem Bestand am Ende des Vorjahres vor diesen Korrekturen.'));
  return parts.join('\n\n');
}

/** Je Zweck Zugang und Verwendung für `finance_lines_list`. */
function linesFilter(data: PurposeFundsReport): Record<string, ReportLinesFilter> {
  return Object.fromEntries(
    data.purposes.flatMap((r) => [
      [`${r.purposeId}.inflow`, { fiscalYearId: data.year.id, purposeId: r.purposeId, direction: 'income' }] as const,
      [`${r.purposeId}.used`, { fiscalYearId: data.year.id, purposeId: r.purposeId, direction: 'expense' }] as const,
    ]),
  );
}

export const purposeFundsReport: ReportDefinition<PurposeFundsReport> = {
  key: 'purposeFunds',
  group: 'taxOffice',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computePurposeFundsReport,
  settingKeys: [TIME_ZONE_SETTING],
  toTypst: purposeFundsTypst,
  titleKey: 'finance.reports.purposeFunds.title',
  paperTitle: 'Zweckmittel',
  linesFilter,
};
