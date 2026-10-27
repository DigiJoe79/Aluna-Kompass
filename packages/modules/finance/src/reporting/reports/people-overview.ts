import { type DbOrTx } from '@kompass/core';
import { personYearOverviewInternal, type PersonYearRow } from '../../allocation/people';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { formatAmount } from '../../format/amount';
import { amountCell, checkYearOrDate, heading, paragraph, reportYearInternal, strongAmountCell, table, textCell, yearParamsSchema } from './common';

/**
 * Personenübersicht (Finanz-Spec § 9.2, Rechenschaft B1 Task 7): Pauschalen nach § 3 Nr. 26/26a EStG und Erstattungen
 * je Person im Kalenderjahr von `endsOn` (Pauschalen gelten je Kalenderjahr, Entscheidung 5 des Plans), mit den
 * Grenzen und dem steuerpflichtigen Teil darüber. Mit Personenbezug.
 */

export interface PeopleOverviewReport {
  calendarYear: number;
  rows: PersonYearRow[];
  linesWithoutPersonCount: number;
  warnings: ('allowanceExceeded' | 'linesWithoutPerson')[];
}

export function computePeopleOverviewReport(db: DbOrTx, params: ReportParams): PeopleOverviewReport {
  const calendarYear = Number(reportYearInternal(db, params.fiscalYearId!).endsOn.slice(0, 4));
  const { rows, linesWithoutPersonCount } = personYearOverviewInternal(db, calendarYear);
  const warnings: PeopleOverviewReport['warnings'] = [];
  if (rows.some((r) => r.allowanceVolunteerExceeded || r.allowanceTrainerExceeded)) warnings.push('allowanceExceeded');
  if (linesWithoutPersonCount > 0) warnings.push('linesWithoutPerson');
  return { calendarYear, rows, linesWithoutPersonCount, warnings };
}

// ── Papier ─────────────────────────────────────────────────────────────────

/** Ohne Zeile: der Satz des PDF, zugleich `empty` des Berichts (Designer Runde 7, 16a D). */
const PEOPLE_EMPTY = 'Im Kalenderjahr gibt es keine Pauschalen und Erstattungen an Personen.';

export function peopleOverviewTypst(data: PeopleOverviewReport, _ctx: ReportRenderContext): string {
  const parts: string[] = [];
  const caps = data.rows[0];
  if (caps) parts.push(paragraph(`Grenzen ${data.calendarYear}: Ehrenamtspauschale (§ 3 Nr. 26a EStG) ${formatAmount(caps.allowanceVolunteerCapCents)} €, Übungsleiterpauschale (§ 3 Nr. 26 EStG) ${formatAmount(caps.allowanceTrainerCapCents)} €. Was darüber liegt, ist steuerpflichtig.`));
  if (data.rows.length === 0) parts.push(paragraph(PEOPLE_EMPTY));
  else {
    parts.push(
      table(
        '(1fr, 26mm, 26mm, 26mm, 26mm, 26mm)',
        ['Person, in €', 'Ehrenamt', 'Übungsleiter', 'steuerpflichtig', 'Erstattungen', 'Verzicht'],
        data.rows.map((r) => {
          const taxable = r.allowanceVolunteerOverCents + r.allowanceTrainerOverCents;
          return [textCell(r.contactName), amountCell(r.allowanceVolunteerCents), amountCell(r.allowanceTrainerCents), taxable > 0 ? strongAmountCell(taxable) : amountCell(0), amountCell(r.reimbursementCents), amountCell(r.waivedCents)];
        }),
      ),
    );
  }
  if (data.warnings.includes('allowanceExceeded')) parts.push(`#block(inset: (y: 4pt))[*Hinweis:* ${paragraph('Bei mindestens einer Person liegen die Pauschalen über der Grenze des Jahres; der Teil darüber ist steuerpflichtig.')}]`);
  if (data.warnings.includes('linesWithoutPerson')) parts.push(heading(3, 'Ohne Person'), paragraph(`${data.linesWithoutPersonCount} Buchungszeilen mit Pauschalen tragen keine Person und fehlen oben.`));
  return parts.join('\n\n');
}

export const peopleOverviewReport: ReportDefinition<PeopleOverviewReport> = {
  key: 'peopleOverview',
  group: 'taxOffice',
  personal: true,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearParamsSchema,
  checkParams: checkYearOrDate,
  years: (_db, params) => (params.fiscalYearId ? [params.fiscalYearId] : []),
  compute: computePeopleOverviewReport,
  toTypst: peopleOverviewTypst,
  empty: (data) => (data.rows.length === 0 && data.warnings.length === 0 ? PEOPLE_EMPTY : null),
  titleKey: 'finance.reports.peopleOverview.title',
  paperTitle: 'Personenübersicht',
  paperPeriod: (data) => `Kalenderjahr ${data.calendarYear}`,
  yearKind: 'calendar',
};
