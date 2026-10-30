import { isoDay, paperDate } from '@kompass/core';
import type { AccountKind } from '../../ledger/queries';
import type { AnnualAccountsAnnex, ReleaseBasis, ReportRenderContext } from '../types';
import type { AnnualAccounts, Amount } from './annual-accounts';
import type { IncomeRow } from './annual-accounts-rows';
import { amountCell, emptyCell, heading, paragraph, small, spanRow, strongAmountCell, strongCell, table, textCell, SPHERE_TITLE } from './common';
import type { ReserveKind } from '../../allocation/reserve-rules';
import { typstText } from '../../typst-pure';

/**
 * Das Papier der Jahresrechnung (Spec 0.4.5 Teil J), deutsch in der Modul-Vorlage wie die übrigen Finanzberichte. Rein.
 * Namen kommen nur aus `ctx.extra.naming` (außerhalb des Hashs), Konten nur als Art, nie Bezeichnung oder IBAN;
 * `data.screen` wird nie gelesen. Abschnitte F1–F9 und der Anhang „Methodik“ haben feste Nummern.
 */

export interface AnnualAccountsRenderExtra {
  naming: { donors: Record<string, string | null>; projects: Record<string, string | null> };
  /** Die Erläuterung als Typst (`renderMarkdownTypst`), leer ohne. */
  explanationTypst: string;
  annex: AnnualAccountsAnnex;
}

const INCOME_ROW_TITLE: Record<IncomeRow, string> = {
  cashDonations: 'Geldspenden',
  inKindDonations: 'Sachspenden',
  bequests: 'Nachlässe',
  membershipFees: 'Mitgliedsbeiträge',
  publicGrants: 'Zuwendungen der öffentlichen Hand',
  otherOrganizations: 'Zuwendungen anderer Organisationen',
  courtFines: 'Geldauflagen',
  revenue: 'Umsatzerlöse',
  assetManagement: 'Vermögensverwaltung',
  other: 'Sonstiges',
};

/** Rücklagen in F5: je Art eine Zeile, immer „Rücklage …“ mit der Fundstelle in Klammern (Abnahme M1). */
const RESERVE_ROW_TEXT: Record<ReserveKind, string> = {
  projectFunds: 'Rücklage für Projekte und Betrieb (§ 62 Abs. 1 Nr. 1 AO)',
  replacement: 'Rücklage für Wiederbeschaffung (§ 62 Abs. 1 Nr. 2 AO)',
  free: 'Freie Rücklage (§ 62 Abs. 1 Nr. 3 AO)',
  participation: 'Rücklage für Beteiligungen (§ 62 Abs. 1 Nr. 4 AO)',
  business: 'Rücklage im wirtschaftlichen Geschäftsbetrieb (AEAO zu § 55 Nr. 3 und Nr. 28)',
  assetManagement: 'Rücklage in der Vermögensverwaltung (AEAO zu § 55 Nr. 3 und Nr. 28)',
};
const ACCOUNT_KIND_TEXT: Record<AccountKind, [string, string]> = { bank: ['Bankkonto', 'Bankkonten'], cash: ['Barkasse', 'Barkassen'], paymentService: ['Zahlungsdienst', 'Zahlungsdienste'] };

/** Fester Text je Begründung der Freigabe — nie der Freitext (Ve-L-7). */
const AUDIT_TEXT: Record<Exclude<ReleaseBasis, 'auditReport'>, string> = {
  noAuditProvided: 'Eine Kassenprüfung ist nicht vorgesehen.',
  oralReport: 'Die Kassenprüfer haben mündlich in der Mitgliederversammlung berichtet.',
  singleAuditor: 'Geprüft von einem Kassenprüfer.',
  notAudited: 'Eine Kassenprüfung hat nicht stattgefunden.',
  other: 'Ohne schriftlichen Prüfbericht festgeschrieben.',
};

const OTHER_WORK = 'übrige Satzungsarbeit';

/**
 * Die Namen der Posten auf dem Papier, die auch die Hinweise am Bildschirm nennen („über 25 %“) — die Bildschirmtexte
 * (`finance.reports.annualAccounts.labels`) halten dieselben, damit der Leser den Posten im PDF findet (Bildabnahme 0.4.5
 * W-3; Test `finance-annual-accounts-labels.test.ts`).
 */
export const ANNUAL_ACCOUNTS_PAPER_NAMES: Readonly<Record<IncomeRow | 'fundraising' | 'administration' | 'projectNone', string>> = { ...INCOME_ROW_TITLE, fundraising: 'Werbung', administration: 'Verwaltung', projectNone: OTHER_WORK };
const PLATFORM_NOTE = 'Spendenplattform; leitet Spenden vieler Einzelspender weiter';
const day = (value: string) => paperDate(isoDay(value));

/** Anteil in Zehntelprozent → „12,3 %“ (eine Nachkommastelle mit Komma); leer ohne Summe. */
function shareText(permille: number | null): string {
  if (permille === null) return '';
  const sign = permille < 0 ? '-' : '';
  const abs = Math.abs(permille);
  return `${sign}${Math.floor(abs / 10)},${abs % 10} %`;
}

const shareCell = (permille: number | null): string => `table.cell(align: right)[${typstText(shareText(permille))}]`;

interface Columns {
  withPrevious: boolean;
  spec: string;
  heads: string[];
  rightHeads: number[];
}

function columnsOf(data: AnnualAccounts, withShare: boolean): Columns {
  const withPrevious = data.previous !== null;
  const heads = ['in €', data.year.designation, ...(withPrevious ? [`Vorjahr ${data.previous!.designation}`] : []), ...(withShare ? ['Anteil'] : [])];
  const count = heads.length - 1;
  return { withPrevious, spec: `(1fr, ${Array.from({ length: count }, () => '28mm').join(', ')})`, heads, rightHeads: Array.from({ length: count }, (_, i) => i + 1) };
}

function amountRow(cols: Columns, title: string, a: Amount, opts: { strong?: boolean; share?: boolean; indent?: boolean } = {}): string[] {
  const cell = opts.strong ? strongAmountCell : amountCell;
  const label = opts.strong ? strongCell(title) : opts.indent ? `[#h(1em)${typstText(title)}]` : textCell(title);
  return [label, cell(a.cents), ...(cols.withPrevious ? [a.previousCents === null ? emptyCell : cell(a.previousCents)] : []), ...(opts.share === false ? [] : [shareCell(a.sharePermille)])];
}

function sumAmounts(list: readonly Amount[], total: number): Amount {
  const cents = list.reduce((s, a) => s + a.cents, 0);
  const previousCents = list.some((a) => a.previousCents === null) ? null : list.reduce((s, a) => s + (a.previousCents ?? 0), 0);
  return { cents, previousCents, sharePermille: total === 0 ? null : Math.round((cents * 1000) / total) };
}
const nonZero = (a: Amount) => a.cents !== 0 || (a.previousCents ?? 0) !== 0;

function glance(data: AnnualAccounts): string {
  const g = data.glance;
  const rows = [
    [textCell('Einnahmen'), amountCell(g.incomeCents)],
    [textCell('Ausgaben'), amountCell(g.expenseCents)],
    [strongCell('Ergebnis'), strongAmountCell(g.resultCents)],
    [textCell(`Vermögen am ${day(data.year.endsOn)}`), amountCell(g.netAssetsCents)],
  ];
  const parts = [heading(2, 'F1 Auf einen Blick'), table('(1fr, 32mm)', ['in €', data.year.designation], rows)];
  if (g.programCentsPerEuro !== null) parts.push(paragraph(`Von jedem Euro flossen ${g.programCentsPerEuro} Cent in die Satzungsarbeit.`));
  return parts.join('\n\n');
}

function incomeSection(data: AnnualAccounts): string {
  const cols = columnsOf(data, true);
  const rows: string[][] = [];
  for (const r of data.income.rows) {
    rows.push(amountRow(cols, INCOME_ROW_TITLE[r.row], r));
    if (r.row === 'cashDonations' && data.income.viaPlatforms) rows.push(amountRow(cols, 'davon über Spendenplattformen', data.income.viaPlatforms, { indent: true }));
  }
  rows.push(amountRow(cols, 'Summe Einnahmen', data.income.total, { strong: true }));
  const spheres = data.income.bySphere.map((s) => amountRow(cols, SPHERE_TITLE[s.sphere], s));
  return [
    heading(2, 'F2 Mittelherkunft'),
    heading(3, 'a) nach Art'),
    table(cols.spec, cols.heads, rows, { rightHeads: cols.rightHeads }),
    heading(3, 'b) nach Bereichen'),
    spheres.length > 0 ? table(cols.spec, cols.heads, spheres, { rightHeads: cols.rightHeads }) : paragraph('Im Geschäftsjahr gibt es keine festgeschriebenen Einnahmen.'),
  ].join('\n\n');
}

/**
 * F3 „übrige Satzungsarbeit“: Ausgaben ohne Projekt plus die der Projekte, die das Papier nicht nennt (nicht publiziert),
 * als ein Betrag mit Anteil an allen Ausgaben; `null` ohne solche Ausgaben. Eine Quelle für PDF und den Hinweis „über
 * 25 %“ am Bildschirm (Abnahme B1, Nachzug 1).
 */
export function otherWorkInternal(expense: AnnualAccounts['expense'], namedProjects: Record<string, string | null>): Amount | null {
  const rest = expense.program.projects.filter((p) => p.projectId === null || !namedProjects[p.projectId]);
  return rest.length > 0 ? sumAmounts(rest, expense.total.cents) : null;
}

function expenseSection(data: AnnualAccounts, extra: AnnualAccountsRenderExtra): string {
  const cols = columnsOf(data, true);
  const e = data.expense;
  const width = cols.heads.length;
  const named = e.program.projects.filter((p) => p.projectId !== null && extra.naming.projects[p.projectId]);
  const otherWork = otherWorkInternal(e, extra.naming.projects);
  const rows: string[][] = [[spanRow(width, 'Programm (Satzungsarbeit)')]];
  for (const p of named) rows.push(amountRow(cols, extra.naming.projects[p.projectId!]!, p, { indent: true }));
  if (otherWork) rows.push(amountRow(cols, OTHER_WORK, otherWork, { indent: true }));
  if (nonZero(e.program.partnerForwarding)) rows.push(amountRow(cols, 'davon Weiterleitung an Partnerorganisationen (§ 58 Nr. 1 AO)', e.program.partnerForwarding, { indent: true }));
  if (nonZero(e.program.auxiliaries)) rows.push(amountRow(cols, 'davon Zahlungen an Hilfspersonen (§ 57 Abs. 1 S. 2 AO)', e.program.auxiliaries, { indent: true }));
  rows.push(amountRow(cols, 'Summe Programm', e.program.total, { strong: true }));
  rows.push(amountRow(cols, ANNUAL_ACCOUNTS_PAPER_NAMES.fundraising, e.fundraising));
  rows.push(amountRow(cols, ANNUAL_ACCOUNTS_PAPER_NAMES.administration, e.administration));
  rows.push(amountRow(cols, 'Summe Satzungsarbeit, Werbung und Verwaltung', e.idealAndPurposeTotal, { strong: true }));
  rows.push(amountRow(cols, 'Ausgaben der Vermögensverwaltung', e.assetManagement));
  rows.push(amountRow(cols, 'Ausgaben des wirtschaftlichen Geschäftsbetriebs', e.business));
  rows.push(amountRow(cols, 'Summe Ausgaben', e.total, { strong: true }));
  return [heading(2, 'F3 Mittelverwendung'), table(cols.spec, cols.heads, rows, { rightHeads: cols.rightHeads })].join('\n\n');
}

function resultSection(data: AnnualAccounts): string {
  const cols = columnsOf(data, false);
  const r = data.result;
  const prev = (pick: (p: NonNullable<AnnualAccounts['result']['previous']>) => number) => (r.previous ? pick(r.previous) : null);
  const rows = [
    amountRow(cols, 'Einnahmen', { cents: r.incomeCents, previousCents: prev((p) => p.incomeCents), sharePermille: null }, { share: false }),
    amountRow(cols, 'Ausgaben', { cents: r.expenseCents, previousCents: prev((p) => p.expenseCents), sharePermille: null }, { share: false }),
    amountRow(cols, 'Ergebnis', { cents: r.resultCents, previousCents: prev((p) => p.resultCents), sharePermille: null }, { strong: true, share: false }),
  ];
  const probe: string[][] = [
    [textCell('Bestand am Anfang'), amountCell(r.probe.openingCents)],
    ...(r.probe.openedInYearCents !== 0 ? [[textCell('Eröffnungsbestände im Jahr'), amountCell(r.probe.openedInYearCents)]] : []),
    [textCell('Ergebnis des Jahres'), amountCell(r.probe.resultCents)],
    [textCell('Veränderung durchlaufender Gelder'), amountCell(r.probe.transitChangeCents)],
    [strongCell('Bestand am Ende'), strongAmountCell(r.probe.closingCents)],
    r.probe.differenceCents === 0 ? [strongCell('Probe: stimmt'), strongAmountCell(0)] : [strongCell('Probe: Abweichung'), strongAmountCell(r.probe.differenceCents)],
  ];
  return [heading(2, 'F4 Ergebnis und Probe'), table(cols.spec, cols.heads, rows, { rightHeads: cols.rightHeads }), table('(1fr, 32mm)', ['in €', data.year.designation], probe)].join('\n\n');
}

function assetsSection(data: AnnualAccounts): string {
  const a = data.assets;
  const rows: string[][] = [];
  for (const kind of ['bank', 'cash', 'paymentService'] as const) {
    const of = a.accounts.filter((x) => x.kind === kind);
    if (of.length === 0) continue;
    rows.push([textCell(ACCOUNT_KIND_TEXT[kind][of.length === 1 ? 0 : 1]), amountCell(of.reduce((s, x) => s + x.cents, 0))]);
  }
  rows.push([textCell('Forderungen'), amountCell(a.receivablesCents)]);
  rows.push([textCell('Verbindlichkeiten'), amountCell(-a.payablesCents)]);
  if (a.otherAssetsCents !== 0) rows.push([textCell('sonstige Vermögensgegenstände'), amountCell(a.otherAssetsCents)]);
  if (a.otherLiabilitiesCents !== 0) rows.push([textCell('sonstige Verpflichtungen'), amountCell(-a.otherLiabilitiesCents)]);
  rows.push([strongCell('Reinvermögen'), strongAmountCell(a.netAssetsCents)]);
  rows.push([textCell('davon zweckgebunden'), amountCell(a.earmarkedCents)]);
  for (const r of a.reserves) rows.push([textCell(RESERVE_ROW_TEXT[r.kind]), amountCell(r.cents)]);
  if (a.endowmentCents !== 0) rows.push([textCell('Vermögen nach § 62 Abs. 3 AO'), amountCell(a.endowmentCents)]);
  rows.push([textCell('übrige Mittel'), amountCell(a.remainingCents)]);
  return [heading(2, `F5 Vermögen am ${day(data.year.endsOn)}`), table('(1fr, 32mm)', ['in €', data.year.designation], rows)].join('\n\n');
}

function projectsSection(data: AnnualAccounts, extra: AnnualAccountsRenderExtra): string {
  const parts = [heading(2, 'F6 Projekte')];
  if (data.projects.length === 0) {
    parts.push(paragraph('Im Geschäftsjahr gibt es keine Buchungen an Projekten.'));
    return parts.join('\n\n');
  }
  const named = data.projects.filter((p) => extra.naming.projects[p.projectId]);
  const rest = data.projects.filter((p) => !named.includes(p));
  const row = (title: string, list: readonly AnnualAccounts['projects'][number][]) => [
    textCell(title),
    amountCell(list.reduce((s, p) => s + p.incomeCents, 0)),
    amountCell(list.reduce((s, p) => s + p.expenseCents, 0)),
    amountCell(list.reduce((s, p) => s + p.purposeClosingCents, 0)),
  ];
  const rows = [...named.map((p) => row(extra.naming.projects[p.projectId]!, [p])), ...(rest.length > 0 ? [row(OTHER_WORK, rest)] : [])];
  parts.push(table('(1fr, 28mm, 28mm, 28mm)', ['in €', 'Einnahmen', 'Ausgaben', `Zweckbestand am ${day(data.year.endsOn)}`], rows, { rightHeads: [1, 2, 3] }));
  return parts.join('\n\n');
}

function ratiosSection(data: AnnualAccounts): string {
  const parts = [heading(2, 'F7 Kennzahlen und Hinweise')];
  if (data.ratios.overheadPermille !== null) {
    parts.push(paragraph(`Werbe- und Verwaltungsquote: ${shareText(data.ratios.overheadPermille)} der Ausgaben für Satzungsarbeit, Werbung und Verwaltung (ohne Vermögensverwaltung und wirtschaftlichen Geschäftsbetrieb).`));
  }
  parts.push(paragraph('Die Arbeit im Verein ist überwiegend ehrenamtlich; ehrenamtliche Stunden sind nicht bewertet.'));
  const title = { remuneration: 'Vergütung an Vorstandsmitglieder', volunteerAllowance: 'Ehrenamtspauschale an Vorstandsmitglieder' } as const;
  const rows = data.remuneration.map((r) => [textCell(title[r.kind]), r.recipients === 0 ? textCell('keine') : r.amountCents === null ? textCell('gezahlt') : amountCell(r.amountCents)]);
  // Wörter stehen nicht unter „in €“ (Bildabnahme 0.4.5 T-2): ohne Betrag kein Spaltenkopf, gemischt beides.
  const amounts = data.remuneration.filter((r) => r.recipients > 0 && r.amountCents !== null).length;
  const head = amounts === 0 ? '' : amounts === data.remuneration.length ? 'in €' : 'Betrag in € bzw. Angabe';
  parts.push(table('(1fr, 40mm)', ['', head], rows));
  return parts.join('\n\n');
}

function donorsSection(data: AnnualAccounts, extra: AnnualAccountsRenderExtra): string {
  const parts = [heading(2, 'F8 Großzuwendungen')];
  if (data.majorDonors.length === 0) {
    parts.push(paragraph('Keine Zuwendung über 10 % der Jahreseinnahmen.'));
    return parts.join('\n\n');
  }
  const rows = data.majorDonors.map((d) => {
    const name = d.contactId ? (extra.naming.donors[d.contactId] ?? null) : null;
    const label = name === null ? (d.platform ? PLATFORM_NOTE : 'Großspende einer Privatperson') : d.platform ? `${name} (${PLATFORM_NOTE})` : name;
    const band = `${d.bandFromPercent}–${d.bandFromPercent + 10} % der Einnahmen`;
    return [textCell(label), name !== null && d.amountCents !== null ? amountCell(d.amountCents) : emptyCell, textCell(band)];
  });
  parts.push(table('(1fr, 28mm, 40mm)', ['Zuwender', 'in €', 'Anteil'], rows, { rightHeads: [1] }));
  return parts.join('\n\n');
}

function notesSection(data: AnnualAccounts, extra: AnnualAccountsRenderExtra): string {
  const parts = [heading(2, 'F9 Erläuterungen, Prüfung, Abzeichnung')];
  if (extra.explanationTypst.trim() !== '') parts.push(extra.explanationTypst);
  const audit = data.notes.audit;
  if (audit) {
    if (audit.basis === 'auditReport') parts.push(paragraph(audit.auditReportFiledOn ? `Geprüft von den Kassenprüfern am ${day(audit.auditReportFiledOn)}.` : 'Geprüft von den Kassenprüfern.'));
    else parts.push(paragraph(AUDIT_TEXT[audit.basis]));
  }
  if (data.notes.cashReport) parts.push(paragraph(`Kassenbericht: ${data.notes.cashReport.documentNumber}.`));
  const annex = extra.annex;
  if (annex.assemblyOn) parts.push(paragraph(`Der Mitgliederversammlung vorgelegt am ${day(annex.assemblyOn)}.`));
  if (annex.signature) {
    const s = annex.signature;
    const scan = s.via === 'scan' && s.scanNumber ? ` (unterschriebenes Exemplar ${s.scanNumber})` : '';
    parts.push(paragraph(`Abgezeichnet von ${s.name}${s.office ? `, ${s.office}` : ''}, am ${day(s.signedOn)}.${scan}`));
  } else {
    parts.push(paragraph('Noch nicht abgezeichnet.'));
  }
  if (annex.replacesFinalizedOn) parts.push(paragraph(`Berichtigte Fassung, ersetzt die vom ${day(annex.replacesFinalizedOn)}.`));
  if (annex.webVersionOn) parts.push(paragraph(`Fassung vom ${day(annex.webVersionOn)} für die Webseite.`));
  return parts.join('\n\n');
}

const METHODOLOGY: readonly string[] = [
  'Die Jahresrechnung ist eine Einnahmen-Ausgaben-Rechnung aus den festgeschriebenen Buchungen des Geschäftsjahres. Durchlaufende Gelder sind nicht enthalten.',
  'Die Mittelherkunft ordnet jede Einnahme nach der Einnahmenart ihrer Kategorie zu; die Mittelverwendung jede Ausgabe nach der Kostenart ihrer Kategorie (Programm, Werbung, Verwaltung) und nach dem Projekt an der Buchung. Auszahlungen von Spendenplattformen stehen unter den Geldspenden.',
  'Sachspenden zählen mit dem gebuchten Wert der Zuwendung.',
  'Die Werbe- und Verwaltungsquote und der Anteil der Satzungsarbeit rechnen nur über die Ausgaben des ideellen Bereichs und der Zweckbetriebe; Vermögensverwaltung und wirtschaftlicher Geschäftsbetrieb stehen getrennt.',
  'Mit Namen erscheinen nur publizierte Projekte; die übrigen stehen zusammengefasst als übrige Satzungsarbeit.',
  'Das Vermögen nach § 62 Abs. 3 AO ist die Summe der Zuwendungen, die dem Vermögen zugeführt wurden.',
  'Zuwender mit mehr als 10 % der Jahreseinnahmen stehen mit Namen nur als juristische Person oder mit Einwilligung, sonst ohne Namen mit einer Bandbreite.',
];

export function annualAccountsTypst(data: AnnualAccounts, ctx: ReportRenderContext): string {
  const extra = (ctx.extra ?? { naming: { donors: {}, projects: {} }, explanationTypst: '', annex: {} }) as unknown as AnnualAccountsRenderExtra;
  return [
    glance(data),
    incomeSection(data),
    expenseSection(data, extra),
    resultSection(data),
    assetsSection(data),
    projectsSection(data, extra),
    ratiosSection(data),
    donorsSection(data, extra),
    notesSection(data, extra),
    heading(2, 'Anhang: Methodik'),
    ...METHODOLOGY.map((m) => small(m)),
  ].join('\n\n');
}
