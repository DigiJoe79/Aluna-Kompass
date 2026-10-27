import { ao52NumbersIn, ao52PurposeOf } from '../../format/tax-purposes';
import { paperDate } from '@kompass/core';
import { formatAmount, formatEuro } from '../../format/amount';
import { typstText } from '../../typst-pure';
import { GEM_SECTION_TITLES, GEM_UNVERIFIED_NOTE, gemFormFor, type GemLine, type GemSection } from '../gem-forms';
import type { ReportRenderContext } from '../types';
import { amountCell, emptyCell, heading, paragraph, small, strongCell, table, textCell } from './common';
import type { GemAttachment, GemHint, GemLineValue, GemOrigin, TaxReturnGemReport } from './tax-return-gem';

/**
 * Papier der Anlage-Gem-Werte (Plan D2 Task 5): Teil 1 „Formularwerte“ je Abschnitt (Zeile · Angabe · je Jahr ·
 * Herkunft), Listen eingerückt unter ihrer Zeile, Lücken „fehlt“, Blöcke ohne Daten „in ELSTER eintragen“; Teil 2 die
 * Beilagen, Teil 3 die Hinweise. Der Wortlaut der Zeilen kommt aus `gem-forms.ts`, nie aus den gehashten Daten.
 */

const CHOICE: Record<string, string> = { onFile: 'liegt dem Finanzamt vor', willSubmit: 'wird gesondert übermittelt', none: 'kein gesonderter Beschluss' };
const REPORT_NAME: Record<string, string> = { taxReturnIncomeStatement: 'EÜR für das Finanzamt', reserveStatement: 'Rücklagenspiegel' };
/** Die Nummer des Zwecks als „Nr. 14 (die Förderung des Tierschutzes)“ — dieselbe Liste wie die Oberfläche. */
const purposeText = (value: unknown): string | null => {
  const p = ao52PurposeOf(typeof value === 'string' ? value : null);
  return p ? `Nr. ${p.number} (${p.text})` : null;
};

const LINES_NAME: Record<string, string> = { business: 'Buchungen im wirtschaftlichen Geschäftsbetrieb', purposeOperation: 'Buchungen im Zweckbetrieb', addsToAssets: 'Buchungen mit Zuführung zum Vermögen', endowmentsReceived: 'Buchungen mit Vermögensausstattung' };
const PART: Record<string, string> = {
  income: 'Einnahmen',
  inKind: 'Sachspenden',
  expenseWaiver: 'Aufwandsspenden',
  addsToAssets: 'Zuführungen zum Vermögen',
  returns: 'Rückzahlungen',
  assetSales: 'Anlagenverkäufe (nicht enthalten)',
  taxRefunds: 'erstattete Steuer (nicht enthalten)',
  transit: 'durchlaufende Gelder (nicht enthalten)',
};

function originText(origin: GemOrigin | undefined): string {
  if (!origin) return '';
  switch (origin.kind) {
    case 'lines': return LINES_NAME[origin.filterKey] ?? 'Buchungen';
    case 'report': return REPORT_NAME[origin.report] ?? origin.report;
    case 'answer': return 'Ihre Angabe';
    case 'notice': return 'Freistellungsbescheid';
    case 'reserves': return 'Rücklagen';
    case 'partnerPayments': return 'Zahlungen an Partner';
  }
}

function valueText(def: GemLine, v: GemLineValue): string {
  const value = v.value;
  if (v.missing && (value === null || value.kind !== 'list')) return 'fehlt';
  if (value === null) return '';
  switch (value.kind) {
    case 'yearRange': return value.from === value.to ? value.from : `${value.from}–${value.to}`;
    case 'amount': return formatAmount(value.cents);
    case 'yesNo': return value.value ? (def.help && def.kind === 'yesNo' && def.required ? 'ja – in ELSTER eintragen' : 'ja') : 'nein';
    case 'date': return paperDate(value.value as never);
    case 'choice': return CHOICE[value.value] ?? value.value;
    case 'text': return value.value;
    case 'elster': return 'in ELSTER eintragen';
    case 'list': return '';
    case 'amountPerYear': return '';
  }
}

/** Eine Listenzeile in Worten: Bezeichnung, Angaben, Betrag. */
function rowText(row: Record<string, string | number | null>, ctx: ReportRenderContext): { label: string; cents: number | null } {
  const missing = (v: unknown) => (v === null || v === undefined ? 'fehlt' : String(v));
  if ('designation' in row) {
    const names = String(row.designation ?? '').split(',').filter(Boolean).map((id) => ctx.categoryNames[id] ?? id).join(', ');
    if ('expenseCents' in row) return { label: `${names} (zusammengefasst, § 64 Abs. 2 AO) · Einnahmen ${formatEuro(Number(row.incomeCents))} · Ausgaben ${formatEuro(Number(row.expenseCents))} · Überschuss`, cents: Number(row.resultCents) };
    return { label: names, cents: Number(row.incomeCents) };
  }
  if ('asset' in row) {
    const name = ctx.labels[`reserve.${row.reserveId}`] ?? String(row.reserveId);
    const extra = [row.expectedCostCents !== null ? `Anschaffungskosten ${formatEuro(Number(row.expectedCostCents))}` : 'Anschaffungskosten —', row.regularDepreciationCents !== null ? `reguläre AfA ${formatEuro(Number(row.regularDepreciationCents))}` : 'reguläre AfA —', `Zuführung ${formatEuro(Number(row.allocatedCents))}`, `Auflösung ${formatEuro(Number(row.dissolvedCents))}`];
    return { label: `${name}: Wirtschaftsgut ${missing(row.asset)} · ${extra.join(' · ')} · kumuliert`, cents: Number(row.balanceCents) };
  }
  if ('company' in row) return { label: `${ctx.labels[`reserve.${row.reserveId}`] ?? row.reserveId}: ${missing(row.company)} · Finanzamt ${missing(row.taxOffice)} · Steuernummer ${missing(row.taxNumber)}`, cents: Number(row.amountCents) };
  if ('party' in row) return { label: `${missing(row.party)} · Finanzamt ${missing(row.taxOffice)} · Steuernummer ${missing(row.taxNumber)} · begünstigter Zweck ${missing(purposeText(row.purpose))}`, cents: Number(row.amountCents) };
  if ('reason' in row) return { label: String(row.reason), cents: Number(row.amountCents) };
  if ('reserveId' in row) return { label: ctx.labels[`reserve.${row.reserveId}`] ?? String(row.reserveId), cents: Number(row.amountCents) };
  return { label: '', cents: null };
}

function attachmentText(a: GemAttachment, designation: Map<string, string>): string {
  const year = a.fiscalYearId ? ` ${designation.get(a.fiscalYearId) ?? ''}` : '';
  switch (a.key) {
    case 'taxReturnIncomeStatement': return 'EÜR für das Finanzamt, je Jahr nach Bereichen';
    case 'assetOverview': return `Vermögensübersicht zum Ende von${year}`;
    case 'reserveStatement': return 'Rücklagenspiegel seit der letzten Erklärung';
    case 'foreignActivity': return `Auslandsbericht${year}`;
    case 'peopleOverview': return `Personenübersicht (Übungsleiter)${year}`;
    case 'assemblyMinutes': return `Protokoll der Mitgliederversammlung zu${year}`;
    case 'activityReport': {
      const all = [...designation.values()];
      return `Tätigkeitsbericht ${all.length > 1 ? `${all[0]}–${all.at(-1)}` : (all[0] ?? '')}`.trim();
    }
    case 'statute': return 'Satzung (wird gesondert übermittelt)';
  }
}

function hintText(h: GemHint): string {
  switch (h.code) {
    case 'kst1FullyExempt': return 'Kein steuerpflichtiger wirtschaftlicher Geschäftsbetrieb über der Freigrenze des § 64 Abs. 3 AO: In der KSt 1 die vollumfängliche Steuerbefreiung angeben; die Anlagen GK und ZVE sowie die Gewerbesteuererklärung entfallen.';
    case 'businessOverLimit': return `${h.designation}: Die Einnahmen der steuerpflichtigen wirtschaftlichen Geschäftsbetriebe (${formatEuro(h.cents)}) liegen über der Freigrenze von ${formatEuro(h.limitCents)} (§ 64 Abs. 3 AO, AEAO zu § 64 Nr. 18). Für dieses Jahr sind die Anlagen GK und ZVE sowie die Gewerbesteuererklärung nötig.`;
    case 'vatReturnRequired': return `${h.year}: Es gibt Umsätze nach § 13b UStG oder einen innergemeinschaftlichen Erwerb; eine Umsatzsteuer-Jahreserklärung ist bis ${paperDate(h.dueOn as never)} abzugeben (§ 18 Abs. 4a UStG).`;
    case 'noVatReturnSmallBusiness': return 'Als Kleinunternehmer (§ 19 UStG) gibt der Verein keine Umsatzsteuer-Jahreserklärung ab.';
    case 'timelyUse':
      if (h.limitCents === null) return `${h.designation}: Die Mittel sind zeitnah zu verwenden (§ 55 Abs. 1 Nr. 5 AO).`;
      return h.required
        ? `${h.designation}: Die Gesamteinnahmen (${formatEuro(h.cents)}) liegen über ${formatEuro(h.limitCents)}; die Mittel sind zeitnah zu verwenden (§ 55 Abs. 1 Nr. 5 AO).`
        : `${h.designation}: Die Gesamteinnahmen (${formatEuro(h.cents)}) liegen nicht über ${formatEuro(h.limitCents)}; die zeitnahe Mittelverwendung gilt für dieses Jahr nicht (§ 55 Abs. 1 Nr. 5 S. 4 AO).`;
    case 'gratuitousCandidates': return `In den Kategorien „Mitgliederbetreuung“ und „Zuwendungen an Mitglieder“ stehen ${h.count} Buchungen über ${formatEuro(h.cents)}. Prüfen Sie die Angabe in Zeile 74.`;
    case 'businessCombined': return 'Mehrere steuerpflichtige wirtschaftliche Geschäftsbetriebe gelten als ein Betrieb (§ 64 Abs. 2 AO); Zeile 11 nennt sie in einem Eintrag. Gemeinkosten gehören nur mit sachlichem Aufteilungsschlüssel hinein (AEAO zu § 64 Nr. 4–6).';
    case 'spheresMergeable': return 'Die Einnahmen aller wirtschaftlichen Geschäftsbetriebe einschließlich Zweckbetriebe liegen nicht über der Grenze, und insgesamt entstand kein Verlust: Ertragsteuerlich prüft das Finanzamt die Zweckbetriebe nicht mehr (§ 64 Abs. 3 S. 2 AO). Für die Umsatzsteuer bleibt die Zuordnung nötig.';
    case 'endowmentNotToAssets': return 'Zeile 70 nennt eine Vermögensausstattung, die nicht dem Vermögen zugeführt wurde. Prüfen Sie, ob der Geber den Verbrauch für laufende Zwecke gestattet hat.';
    case 'revenueDefinition': return 'Gesamteinnahmen nach dem Einnahmenbegriff des AEAO zu § 55 Nr. 30. Aufwandsspenden sind enthalten (BMF 25.11.2014 Nr. 5: Geldspende); manche Praxisquellen rechnen sie nicht ein. Darlehen sind keine Einnahmen und gehören nicht als Einnahme gebucht.';
    case 'unverifiedLines': return `${GEM_UNVERIFIED_NOTE}. Vergleichen Sie die Zeilen 50 bis 70 vor der Abgabe mit Mein ELSTER.`;
    case 'formAssumed': return `Der Vordruck ${h.formYear} ist noch nicht erschienen; Kompass nimmt den Aufbau von 2025 an.`;
  }
}

export function taxReturnGemTypst(data: TaxReturnGemReport, ctx: ReportRenderContext): string {
  const form = gemFormFor(data.formYear);
  const defs = new Map((form?.lines ?? []).map((l) => [l.line, l]));
  const designation = new Map(data.years.map((y) => [y.id, y.designation]));
  const yearCols = data.years.length;
  const lastCol = yearCols - 1;
  const cols = `(14mm, 1fr, ${Array.from({ length: yearCols }, () => '30mm').join(', ')}, 46mm)`;
  const header = ['Zeile', 'Angabe', ...data.years.map((y) => y.designation), 'Herkunft'];
  const amountsAt = (at: number, cents: number | null) => Array.from({ length: yearCols }, (_, i) => (i === at && cents !== null ? amountCell(cents) : emptyCell));
  const textAt = (text: string, strong: boolean) => Array.from({ length: yearCols }, (_, i) => (i === lastCol ? (strong ? strongCell(text) : textCell(text)) : emptyCell));
  const indent = (text: string) => `[#h(4mm)${typstText(text)}]`;

  const parts: string[] = [heading(2, 'Formularwerte')];
  const sections: GemSection[] = [];
  for (const v of data.lines) {
    const section = defs.get(v.line)?.section;
    if (section && !sections.includes(section)) sections.push(section);
  }
  for (const section of sections) {
    parts.push(heading(3, GEM_SECTION_TITLES[section]));
    const rows: string[][] = [];
    for (const v of data.lines.filter((l) => defs.get(l.line)?.section === section)) {
      const def = defs.get(v.line)!;
      const value = v.value;
      const origin = textCell(originText(v.origin));
      if (value?.kind === 'amountPerYear') {
        const byYear = new Map(value.perYear.map((p) => [p.fiscalYearId, p.cents]));
        rows.push([textCell(value.perYear.map((p) => p.line).join(', ')), textCell(def.label), ...data.years.map((y) => (byYear.has(y.id) ? amountCell(byYear.get(y.id)!) : emptyCell)), origin]);
        for (const part of value.parts.filter((p) => p.cents !== 0)) rows.push([emptyCell, indent(`davon ${PART[part.key] ?? part.key}`), ...amountsAt(lastCol, part.cents), emptyCell]);
        continue;
      }
      if (value?.kind === 'amount') rows.push([textCell(v.line), textCell(def.label), ...amountsAt(lastCol, value.cents), origin]);
      else if (value?.kind === 'text') {
        // Ein Text (Zwecke des Bescheids, Zeile 4) steht unter der Angabe, in der Wertspalte die Nummern nach § 52 AO
        // — wie auf der Seite (Designer Runde 7, 321).
        const numbers = ao52NumbersIn(value.value);
        rows.push([textCell(v.line), `[${typstText(def.label)} \ #text(size: 8pt)[${typstText(value.value)}]]`, ...textAt(numbers.length > 0 ? `Nr. ${numbers.join(', ')}` : '', false), origin]);
      } else rows.push([textCell(v.line), textCell(def.label), ...textAt(valueText(def, v), v.missing), origin]);
      if (value?.kind === 'list') {
        for (const row of value.rows) {
          const r = rowText(row, ctx);
          rows.push([emptyCell, indent(r.label), ...amountsAt(lastCol, r.cents), emptyCell]);
        }
        if (v.missing) rows.push([emptyCell, indent('Angaben fehlen'), ...textAt('fehlt', true), emptyCell]);
      }
    }
    parts.push(table(cols, header, rows, { rightHeads: data.years.map((_, i) => i + 2) }));
  }
  parts.push(heading(2, 'Beilagen'));
  parts.push(data.attachments.map((a) => `- ${typstText(attachmentText(a, designation))}`).join('\n'));
  parts.push(heading(2, 'Hinweise'));
  for (const h of data.hints) parts.push(paragraph(hintText(h)));
  parts.push(small('Kompass stellt die Werte bereit; übertragen und abgeben müssen Sie sie in Mein ELSTER.'));
  return parts.join('\n\n');
}
