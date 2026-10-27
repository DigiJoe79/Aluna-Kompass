import { invalid, notFound, paperDate, type DbOrTx, type Failure } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { asc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { freeReserveCapInternal } from '../../allocation/reserves';
import { reserveBalanceAt } from '../../ledger/reserve-balances';
import { financeReserveMovements, financeReserves } from '../../schema';
import { dayBefore } from '../other-assets';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { amountCell, heading, paragraph, previousYearInternal, reportYearInternal, strongCell, table, textCell, yearRowInternal, type ReportYear } from './common';

/**
 * Rücklagenspiegel (Finanz-Spec § 9.2, Rechenschaft B1 Task 4): je Rücklage Art nach § 62 Abs. 1 Nr. 1–4 AO, Zweck und
 * je Jahr Anfang, Zuführung, Verwendung, Auflösung und Ende; darunter die Vorgänge mit Bezugsjahr und Beschluss
 * (§ 62 Abs. 2 AO) und je Jahr der Höchstbetrag der freien Rücklage. Ein bis drei aufeinanderfolgende Jahre — die
 * Oberfläche bietet eines, über MCP mehrere (Entscheidung 8 des Plans). Querformat.
 */

export type ReserveKind = 'projectFunds' | 'replacement' | 'free' | 'participation';

export interface ReserveStatementYear {
  fiscalYearId: string;
  openingCents: number;
  allocatedCents: number;
  withdrawnCents: number;
  dissolvedCents: number;
  closingCents: number;
}

export interface ReserveStatementMovement {
  kind: 'allocate' | 'withdraw' | 'dissolve';
  movementDate: string;
  amountCents: number;
  forFiscalYearId: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
}

export interface ReserveStatementReport {
  years: ReportYear[];
  reserves: { reserveId: string; kind: ReserveKind; purposeId: string | null; perYear: ReserveStatementYear[]; movements: ReserveStatementMovement[] }[];
  freeReserveCap: { fiscalYearId: string; capCents: number; allocatedForYearCents: number; exceeded: boolean }[];
  warnings: 'freeReserveCapExceeded'[];
}

const paramsSchema: z.ZodType<ReportParams> = z.union([
  z.object({ fiscalYearId: z.string().min(1) }).strict(),
  z.object({ fiscalYearIds: z.array(z.string().min(1)).min(1).max(3) }).strict(),
]);

const yearIdsOf = (params: ReportParams): string[] => params.fiscalYearIds ?? (params.fiscalYearId ? [params.fiscalYearId] : []);

/** Alle Jahre bekannt, in der Reihenfolge der Zeit und ohne Lücke. */
function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  const ids = yearIdsOf(params);
  const unknown = ids.find((id) => !yearRowInternal(db, id));
  if (unknown) return notFound('financeFiscalYear', unknown);
  for (let i = 1; i < ids.length; i++) {
    if (previousYearInternal(db, reportYearInternal(db, ids[i]!))?.id !== ids[i - 1]) return invalid([{ path: 'fiscalYearIds', message: 'notConsecutive' }]);
  }
  return null;
}

export function computeReserveStatementReport(db: DbOrTx, params: ReportParams): ReserveStatementReport {
  const years = yearIdsOf(params).map((id) => reportYearInternal(db, id));
  const first = years[0]!;
  const last = years.at(-1)!;
  const movements = db.select().from(financeReserveMovements).orderBy(asc(financeReserveMovements.movementDate), asc(financeReserveMovements.createdAt), asc(financeReserveMovements.id)).all();
  const resolutionIds = [...new Set(movements.map((m) => m.resolutionDocumentId).filter((id): id is string => id !== null))];
  const resolutions = new Map(resolutionIds.length === 0 ? [] : db.select({ id: documents.id, number: documents.number, documentDate: documents.documentDate }).from(documents).where(inArray(documents.id, resolutionIds)).all().map((d) => [d.id, d]));

  const reserves = db
    .select()
    .from(financeReserves)
    .orderBy(asc(financeReserves.createdAt), asc(financeReserves.id))
    .all()
    .flatMap((reserve): ReserveStatementReport['reserves'] => {
      const own = movements.filter((m) => m.reserveId === reserve.id);
      const perYear = years.map((y): ReserveStatementYear => {
        const inYear = own.filter((m) => m.movementDate >= y.startsOn && m.movementDate <= y.endsOn);
        const sumOf = (kind: ReserveStatementMovement['kind']) => inYear.filter((m) => m.kind === kind).reduce((s, m) => s + m.amountCents, 0);
        // Ein Vortrag, der im Jahr beginnt, ist der Anfang dieses Jahres (Rücklagen vor Kompass).
        const carryForwardInYear = reserve.carryForwardCents !== null && reserve.carryForwardDate !== null && reserve.carryForwardDate >= y.startsOn && reserve.carryForwardDate <= y.endsOn ? reserve.carryForwardCents : 0;
        return {
          fiscalYearId: y.id,
          openingCents: reserveBalanceAt(reserve, own, dayBefore(y.startsOn)) + carryForwardInYear,
          allocatedCents: sumOf('allocate'),
          withdrawnCents: sumOf('withdraw'),
          dissolvedCents: sumOf('dissolve'),
          closingCents: reserveBalanceAt(reserve, own, y.endsOn),
        };
      });
      const inRange = own.filter((m) => m.movementDate >= first.startsOn && m.movementDate <= last.endsOn);
      if (inRange.length === 0 && perYear.every((y) => y.openingCents === 0 && y.closingCents === 0)) return [];
      return [{
        reserveId: reserve.id,
        kind: reserve.kind,
        purposeId: reserve.purposeId,
        perYear,
        movements: inRange.map((m) => {
          const resolution = m.resolutionDocumentId ? resolutions.get(m.resolutionDocumentId) : undefined;
          return { kind: m.kind, movementDate: m.movementDate, amountCents: m.amountCents, forFiscalYearId: m.forFiscalYearId, resolutionNumber: resolution?.number ?? null, resolutionDate: resolution?.documentDate ?? null };
        }),
      }];
    });

  const freeReserveCap = years.map((y) => {
    const cap = freeReserveCapInternal(db, y.id)!;
    return { fiscalYearId: y.id, capCents: cap.capCents, allocatedForYearCents: cap.usedCents, exceeded: cap.exceeded };
  });
  return { years, reserves, freeReserveCap, warnings: freeReserveCap.some((c) => c.exceeded) ? ['freeReserveCapExceeded'] : [] };
}

// ── Papier ─────────────────────────────────────────────────────────────────

/** Art nach § 62 Abs. 1 AO — dieselben Wörter wie die Oberfläche (`finance.reserves.kinds`). */
const KIND_TEXT: Record<ReserveKind, string> = {
  projectFunds: 'Projekt- und Betriebsmittel (§ 62 Abs. 1 Nr. 1 AO)',
  replacement: 'Wiederbeschaffung (§ 62 Abs. 1 Nr. 2 AO)',
  free: 'freie Rücklage (§ 62 Abs. 1 Nr. 3 AO)',
  participation: 'Beteiligung (§ 62 Abs. 1 Nr. 4 AO)',
};
const MOVEMENT_TEXT: Record<ReserveStatementMovement['kind'], string> = { allocate: 'Zuführung', withdraw: 'Verwendung', dissolve: 'Auflösung' };

export function reserveStatementTypst(data: ReserveStatementReport, ctx: ReportRenderContext): string {
  const designation = new Map(data.years.map((y) => [y.id, y.designation]));
  const parts: string[] = [];
  if (data.reserves.length === 0) parts.push(paragraph(data.years.length > 1 ? 'In den Geschäftsjahren gibt es keine Rücklagen.' : 'Im Geschäftsjahr gibt es keine Rücklagen.'));
  for (const r of data.reserves) {
    // „in €“ im Abschnittstitel wie im Kassenbericht (Designer Runde 8, 269/270), nicht schwebend über der Tabelle; die
    // Köpfe rechtsbündig wie die Werte (Abnahme B1).
    parts.push(heading(2, `${ctx.labels[`reserve.${r.reserveId}`] ?? r.reserveId}, in €`));
    const purpose = r.purposeId ? ` · Zweck: ${ctx.labels[`purpose.${r.purposeId}`] ?? r.purposeId}` : '';
    parts.push(paragraph(`${KIND_TEXT[r.kind]}${purpose}`));
    parts.push(
      table(
        '(1fr, 32mm, 32mm, 32mm, 32mm, 32mm)',
        ['Jahr', 'Anfang', 'Zuführung', 'Verwendung', 'Auflösung', 'Ende'],
        r.perYear.map((y) => [textCell(designation.get(y.fiscalYearId) ?? ''), amountCell(y.openingCents), amountCell(y.allocatedCents), amountCell(y.withdrawnCents), amountCell(y.dissolvedCents), amountCell(y.closingCents)]),
        { rightHeads: [1, 2, 3, 4, 5] },
      ),
    );
    if (r.movements.length > 0) {
      // „für Jahr“ nur bei der freien Rücklage: Nur dort gibt es Nachholung (Designer Runde 8, 269/270).
      const forYear = r.kind === 'free';
      parts.push(
        table(
          forYear ? '(26mm, 1fr, 32mm, 30mm, 40mm, 30mm)' : '(26mm, 1fr, 32mm, 40mm, 30mm)',
          ['Datum', 'Vorgang', 'Betrag', ...(forYear ? ['für Jahr'] : []), 'Beschluss', 'vom'],
          r.movements.map((m) => [
            textCell(paperDate(m.movementDate as never)),
            textCell(MOVEMENT_TEXT[m.kind]),
            amountCell(m.amountCents),
            ...(forYear ? [textCell(m.forFiscalYearId ? (designation.get(m.forFiscalYearId) ?? '') : '')] : []),
            textCell(m.resolutionNumber ?? ''),
            textCell(m.resolutionDate ? paperDate(m.resolutionDate as never) : ''),
          ]),
          { rightHeads: [2] },
        ),
      );
    }
  }
  // Ohne Zeile zwischen Überschrift und Tabelle bricht die Überschrift mit der ersten Zeile um (Designer Runde 8, 270).
  parts.push(heading(2, 'Höchstbetrag freie Rücklage (§ 62 Abs. 1 Nr. 3 AO), in €'));
  parts.push(
    table(
      // Breit genug, dass „zugeführt für das Jahr“ als ein Kopf rechtsbündig über der Zahl steht (Designer Runde 7, 262).
      '(1fr, 40mm, 52mm, 30mm)',
      ['Jahr', 'Höchstbetrag', 'zugeführt für das Jahr', ''],
      data.freeReserveCap.map((c) => [textCell(designation.get(c.fiscalYearId) ?? ''), amountCell(c.capCents), amountCell(c.allocatedForYearCents), c.exceeded ? strongCell('überschritten') : textCell('')]),
      { rightHeads: [1, 2] },
    ),
  );
  if (data.warnings.includes('freeReserveCapExceeded')) parts.push(`#block(inset: (y: 4pt))[*Hinweis:* ${paragraph('Die Zuführungen zur freien Rücklage liegen in einem Jahr über dem Höchstbetrag nach § 62 Abs. 1 Nr. 3 AO.')}]`);
  return parts.join('\n\n');
}

export const reserveStatementReport: ReportDefinition<ReserveStatementReport> = {
  key: 'reserveStatement',
  group: 'taxOffice',
  personal: false,
  available: true,
  orientation: 'landscape',
  paramsSchema,
  checkParams,
  years: (_db, params) => yearIdsOf(params),
  compute: computeReserveStatementReport,
  toTypst: reserveStatementTypst,
  titleKey: 'finance.reports.reserveStatement.title',
  paperTitle: 'Rücklagenspiegel',
};
