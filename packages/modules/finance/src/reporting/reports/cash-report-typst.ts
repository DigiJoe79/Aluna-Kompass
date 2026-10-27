import { isoDay, paperDate } from '@kompass/core';
import { formatEuro } from '../../format/amount';
import type { Sphere } from '../../ledger/queries';
import type { ReportRenderContext } from '../types';
import { otherAssetsTypst } from './asset-overview';
import type { CashReport } from './cash-report';
import { amountCell, emptyCell, heading, paragraph, small, spanRow, strongAmountCell, strongCell, table, textCell } from './common';
import type { IncomeStatementReportCategory } from './income-statement';

/**
 * Der Körper des Kassenberichts nach Board 8a/8b: Seite 1 links die Brücke (1 Anfang → 3 Ergebnis → 5 Ende → 6
 * Probe, dazu 4 durchlaufende Gelder), rechts 2 Einnahmen und Ausgaben je Kategorie mit Spalten je Bereich, Summe
 * und Vorjahr; Seite 2 Bindungen, offene Zahlungen, sonstiges Vermögen, Organmitglieder, Korrekturen an Vorjahren
 * (nur wenn es welche gibt) und die Unterschriftszeile (Einstellung). 9 pt, Spalten fest, Beträge ohne „€“.
 */

/** Etwa so viele Kategorien passen bei 9 pt auf Seite 1 (Designer 9.); darüber fasst je Bereich „Übrige“ zusammen. */
export const CATEGORY_ROWS_ON_PAGE_ONE = 22;
export const FOLDED_LABEL = 'Übrige';
export const FOLDED_NOTE = 'Einzeln in der Einnahmen-Überschuss-Rechnung.';

const SPHERE_SHORT: Record<Sphere, string> = { ideal: 'Ideell', assetManagement: 'Vermögens­verw.', purposeOperation: 'Zweck­betrieb', business: 'Geschäfts­betrieb' };

type Row = { sphere: Sphere; direction: 'income' | 'expense'; categoryId: string | null; sumCents: number; previousSumCents: number | null };

/**
 * Faltet je Bereich und Richtung die kleinsten Kategorien zu „Übrige“, bis die Zeilen auf Seite 1 passen. Nur
 * Darstellung: Die Daten (und der Hash) behalten jede Kategorie; die Summen bleiben gleich.
 */
export function foldCategories(spheres: CashReport['income']['spheres'], limit = CATEGORY_ROWS_ON_PAGE_ONE): { rows: Row[]; folded: boolean } {
  const all: Row[] = spheres.flatMap((s) => s.categories.map((c: IncomeStatementReportCategory) => ({ sphere: s.sphere, direction: c.direction, categoryId: c.categoryId, sumCents: c.sumCents, previousSumCents: c.previousSumCents })));
  if (all.length <= limit) return { rows: all, folded: false };
  const groupOf = (r: Row) => `${r.sphere}:${r.direction}`;
  const foldedIds = new Set<string>();
  const groupsWithRest = new Set<string>();
  let count = all.length;
  for (const r of [...all].sort((a, b) => Math.abs(a.sumCents) - Math.abs(b.sumCents) || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''))) {
    if (count <= limit) break;
    foldedIds.add(r.categoryId!);
    count -= 1;
    if (!groupsWithRest.has(groupOf(r))) {
      groupsWithRest.add(groupOf(r));
      count += 1;
    }
  }
  const rows: Row[] = [];
  for (const group of [...new Set(all.map(groupOf))]) {
    const members = all.filter((r) => groupOf(r) === group);
    rows.push(...members.filter((r) => !foldedIds.has(r.categoryId!)));
    const rest = members.filter((r) => foldedIds.has(r.categoryId!));
    if (rest.length > 0) {
      const previous = rest.some((r) => r.previousSumCents === null) ? null : rest.reduce((s, r) => s + r.previousSumCents!, 0);
      rows.push({ sphere: rest[0]!.sphere, direction: rest[0]!.direction, categoryId: null, sumCents: rest.reduce((s, r) => s + r.sumCents, 0), previousSumCents: previous });
    }
  }
  return { rows, folded: true };
}

const day = (iso: string) => paperDate(isoDay(iso));
const shown = (direction: 'income' | 'expense', cents: number) => (direction === 'expense' ? -cents : cents);

function bridge(data: CashReport, ctx: ReportRenderContext): string {
  const name = (id: string) => ctx.accountNames[id] ?? id;
  const rows: string[][] = [[spanRow(2, `1 Bestände am ${day(data.year.startsOn)} (Anfang)`)]];
  for (const a of data.accounts) rows.push([textCell(name(a.accountId)), amountCell(a.openingCents)]);
  rows.push([strongCell('Summe Anfang'), strongAmountCell(data.probe.openingCents)]);
  if (data.probe.openedInYearCents !== 0) rows.push([textCell('Eröffnungsbestände im Jahr'), amountCell(data.probe.openedInYearCents)]);
  rows.push([textCell('3 Ergebnis des Jahres'), amountCell(data.probe.resultCents)]);
  rows.push([textCell('4 Veränderung durchlaufender Gelder'), amountCell(data.probe.transitChangeCents)]);
  rows.push([spanRow(2, `5 Bestände am ${day(data.year.endsOn)} (Ende)`)]);
  for (const a of data.accounts) rows.push([textCell(name(a.accountId)), amountCell(a.closingCents)]);
  rows.push([strongCell('Summe Ende'), strongAmountCell(data.probe.closingCents)]);
  rows.push(data.probe.differenceCents === 0 ? [strongCell('6 Probe: stimmt'), strongAmountCell(0)] : [strongCell('6 Probe: Abweichung'), strongAmountCell(data.probe.differenceCents)]);

  const transit = table('(1fr, 26mm)', ['4 Durchlaufende Gelder, in €', ''], [
    [textCell('am Anfang'), amountCell(data.transit.openingCents)],
    [textCell('Zugang'), amountCell(data.transit.inflowCents)],
    [textCell('Abgang'), amountCell(-data.transit.outflowCents)],
    [strongCell('am Ende'), strongAmountCell(data.transit.closingCents)],
  ]);
  const parts = [table('(1fr, 26mm)', ['Bestände, in €', ''], rows)];
  if (data.probe.differenceCents !== 0) parts.push(small('Die Probe rechnet nur über Geld: Anfang + Eröffnungsbestände + Ergebnis + Veränderung durchlaufender Gelder = Ende. Die Abweichung ist ein Fehler in den Daten; festschreiben lässt sich der Bericht erst, wenn sie behoben ist.'));
  parts.push(transit);
  return parts.join('\n\n');
}

function incomeAndExpenses(data: CashReport, ctx: ReportRenderContext): string {
  const spheres = data.income.spheres.map((s) => s.sphere);
  const withPrevious = data.income.previous !== null;
  const width = 1 + spheres.length + 1 + (withPrevious ? 1 : 0);
  const columns = `(1fr, ${spheres.map(() => '21mm').join(', ')}${spheres.length > 0 ? ', ' : ''}22mm${withPrevious ? ', 22mm' : ''})`;
  const header = ['2 Einnahmen und Ausgaben, in €', ...spheres.map((s) => SPHERE_SHORT[s]), 'Summe', ...(withPrevious ? ['Vorjahr'] : [])];
  const { rows: categoryRows, folded } = foldCategories(data.income.spheres);
  const rows: string[][] = [];
  const sphereCells = (pick: (sphere: Sphere) => number | null) => spheres.map((s) => {
    const v = pick(s);
    return v === null ? emptyCell : amountCell(v);
  });
  for (const direction of ['income', 'expense'] as const) {
    rows.push([spanRow(width, direction === 'income' ? 'Einnahmen' : 'Ausgaben')]);
    for (const r of categoryRows.filter((x) => x.direction === direction)) {
      const value = shown(direction, r.sumCents);
      rows.push([
        textCell(r.categoryId === null ? FOLDED_LABEL : (ctx.categoryNames[r.categoryId] ?? r.categoryId)),
        ...sphereCells((s) => (s === r.sphere ? value : null)),
        amountCell(value),
        ...(withPrevious ? [r.previousSumCents === null ? emptyCell : amountCell(shown(direction, r.previousSumCents))] : []),
      ]);
    }
    const total = (s: Sphere) => {
      const sphere = data.income.spheres.find((x) => x.sphere === s)!;
      return direction === 'income' ? sphere.incomeCents : sphere.expenseCents;
    };
    const previousTotal = data.income.spheres.reduce((acc, s) => acc + s.categories.filter((c) => c.direction === direction).reduce((a, c) => a + shown(direction, c.previousSumCents ?? 0), 0), 0);
    rows.push([
      strongCell(direction === 'income' ? 'Summe Einnahmen' : 'Summe Ausgaben'),
      ...spheres.map((s) => strongAmountCell(total(s))),
      strongAmountCell(direction === 'income' ? data.income.totalIncomeCents : data.income.totalExpenseCents),
      ...(withPrevious ? [strongAmountCell(previousTotal)] : []),
    ]);
  }
  const previousResult = data.income.spheres.reduce((acc, s) => acc + (s.previousResultCents ?? 0), 0);
  rows.push([strongCell('3 Ergebnis'), ...spheres.map((s) => strongAmountCell(data.income.spheres.find((x) => x.sphere === s)!.resultCents)), strongAmountCell(data.income.resultCents), ...(withPrevious ? [strongAmountCell(previousResult)] : [])]);
  const parts = [table(columns, header, rows)];
  if (folded) parts.push(small(`„${FOLDED_LABEL}“: ${FOLDED_NOTE}`));
  if (spheres.length === 0) parts.push(paragraph('Im Geschäftsjahr gibt es keine festgeschriebenen Einnahmen und Ausgaben.'));
  return parts.join('\n\n');
}

function bindingsTypst(data: CashReport, ctx: ReportRenderContext): string {
  const { purposes, reserves } = data.bindings;
  const parts = [heading(3, `7 Zweckbindungen und Rücklagen, in €`)];
  if (purposes.length === 0 && reserves.length === 0) {
    parts.push(paragraph('Keine Zweckbindungen und Rücklagen im Jahr.'));
    return parts.join('\n\n');
  }
  const rows: string[][] = [];
  if (purposes.length > 0) {
    rows.push([spanRow(5, 'Zweckgebunden')]);
    for (const p of purposes) rows.push([textCell(ctx.labels[`purpose.${p.purposeId}`] ?? p.purposeId), amountCell(p.carryForwardCents), amountCell(p.inflowCents), amountCell(p.usedCents), amountCell(p.closingCents)]);
  }
  if (reserves.length > 0) {
    rows.push([spanRow(5, 'Rücklagen')]);
    for (const r of reserves) rows.push([textCell(ctx.labels[`reserve.${r.reserveId}`] ?? r.reserveId), amountCell(r.openingCents), amountCell(r.addedCents), amountCell(r.releasedCents), amountCell(r.closingCents)]);
  }
  parts.push(table('(1fr, 22mm, 22mm, 22mm, 22mm)', ['', 'Vortrag', 'Zugang', 'Verwendet', 'Ende'], rows));
  return parts.join('\n\n');
}

const ROLE: Record<CashReport['organPayments'][number]['role'], string> = { 'board-member': 'Vorstand', 'related-party': 'Nahestehende Person' };
const KIND: Record<CashReport['organPayments'][number]['kind'], string> = { remuneration: 'Vergütung', reimbursement: 'Aufwandsersatz', other: 'Sonstiges' };

function organTypst(data: CashReport): string {
  const parts = [heading(3, '10 Zahlungen an Organmitglieder, in €')];
  if (data.organPayments.length === 0) parts.push(paragraph('Keine Zahlungen an Organmitglieder und nahestehende Personen im Jahr.'));
  else parts.push(table('(1fr, 28mm, 18mm, 22mm)', ['Funktion', 'Art', 'Personen', 'Betrag'], data.organPayments.map((p) => [textCell(ROLE[p.role]), textCell(KIND[p.kind]), `table.cell(align: right)[${p.personCount}]`, amountCell(p.amountCents)])));
  if (data.organPersonsOverLiabilityLimit > 0 && data.organLiabilityLimitCents !== null) {
    const n = data.organPersonsOverLiabilityLimit;
    parts.push(small(`${n === 1 ? 'Ein Vorstandsmitglied erhielt' : `${n} Vorstandsmitglieder erhielten`} im Jahr mehr als ${formatEuro(data.organLiabilityLimitCents)} Vergütung; die Haftungserleichterung des § 31a BGB gilt dann nicht.`));
  }
  parts.push(small('Ohne Namen. Über Vergütungen entscheidet die Mitgliederversammlung.'));
  return parts.join('\n\n');
}

const CHANGE_TEXT = { new: 'neu', reversed: 'zurückgenommen', changed: 'geändert' } as const;

function correctionsTypst(data: CashReport): string | null {
  const carried = data.priorYearCarryOvers ?? [];
  if (data.priorYearCorrections.length === 0 && carried.length === 0) return null;
  // Designer Runde 8, 253/256: eine Form für beide Arten — Buchung, Geschäftsjahr, was sich geändert hat.
  const rows = [
    ...data.priorYearCorrections.map((c) => [textCell(c.entryNumber), textCell(c.fiscalYearDesignation), textCell(`Zuordnung korrigiert am ${day(c.appliedOn)}`)]),
    ...carried.map((c) => [textCell(c.entryNumber), textCell(c.fiscalYearDesignation), textCell(`${CHANGE_TEXT[c.change]} nach der Mitgliederversammlung`)]),
  ];
  const parts = [heading(3, '11 Korrekturen an Vorjahren'), table('(1fr, 28mm, 62mm)', ['Buchung', 'Geschäftsjahr', 'Änderung'], rows)];
  if (data.priorYearCorrections.length > 0) parts.push(small('Zuordnungen von Buchungen früherer Jahre, die in diesem Jahr korrigiert wurden; Bestände und Ergebnis der Vorjahre bleiben, wie sie vorgelegt wurden.'));
  if (carried.length > 0) parts.push(small('Änderungen an Vorjahren nach deren Mitgliederversammlung: Sie gingen nicht mehr in die Prüfung des Vorjahres und werden mit diesem Bericht vorgelegt.'));
  return parts.join('\n\n');
}

function signatureTypst(ctx: ReportRenderContext): string | null {
  if (ctx.labels['setting.cashReportSignature'] !== 'true') return null;
  const line = (label: string) => `[#v(14mm) #line(length: 100%, stroke: 0.5pt) #text(size: 8pt)[${paragraph(label)}]]`;
  return `#v(6mm)\n#grid(columns: (1fr, 1fr), column-gutter: 16mm, ${line('Ort, Datum')}, ${line('Unterschrift Vorstand')})`;
}

export function cashReportTypst(data: CashReport, ctx: ReportRenderContext): string {
  const pageOne = `#grid(columns: (95mm, 1fr), column-gutter: 8mm,\n[\n${bridge(data, ctx)}\n],\n[\n${incomeAndExpenses(data, ctx)}\n])`;
  const left = [
    bindingsTypst(data, ctx),
    heading(3, `8 Offene Zahlungen am ${day(data.year.endsOn)}, in €`),
    table('(1fr, 26mm)', ['', 'Betrag'], [
      [textCell('an den Verein (Forderungen)'), amountCell(data.openItems.receivablesCents)],
      [textCell('des Vereins (Verbindlichkeiten)'), amountCell(data.openItems.payablesCents)],
    ]),
  ].join('\n\n');
  const right = [otherAssetsTypst('9 Sonstiges Vermögen und Verpflichtungen', data.otherAssets, data.year.endsOn, ctx, 3), organTypst(data), correctionsTypst(data)].filter(Boolean).join('\n\n');
  const pageTwo = `#grid(columns: (1fr, 1fr), column-gutter: 10mm,\n[\n${left}\n],\n[\n${right}\n])`;
  return ['#set text(size: 9pt)', pageOne, '#pagebreak()', pageTwo, signatureTypst(ctx)].filter(Boolean).join('\n\n');
}
