import { createHash } from 'node:crypto';
import { readSetting, type DbOrTx, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { canonicalJson } from './hash';
import { computeAssetOverviewReport } from './reports/asset-overview';
import { computeReserveStatementReport } from './reports/reserve-statement';
import { computeTaxReturnGemReport, taxReturnGemReport, type GemValue } from './reports/tax-return-gem';
import { computeTaxReturnIncomeStatementReport, taxReturnIncomeStatementReport } from './reports/tax-return-income-statement';
import type { ReportComputeEnv } from './types';
import { financeTaxAmendmentChecks, financeTaxAmendments, financeTaxPeriods, type FinanceTaxAmendmentCheckRow, type FinanceTaxAmendmentRow } from '../schema';
import { taxPeriodInternal, type TaxFigureCause, type TaxFiguresAttachment } from '../ledger/tax-periods';

/**
 * B9 (Spec 0.5.2 § 4.1): das Abbild einer abgegebenen Steuererklärung — die Werte der Anlage Gem und die Beträge der drei
 * Beilagen aus Kompass, so dass zwei Abbilder vergleichbar sind. Gleiche Werte, gleiches Abbild: Wiederöffnen, Storno
 * der Fassung, eine umbenannte Kategorie oder eine geänderte Herkunft ändern nichts (N24).
 *
 * - **Anlage Gem** in Formulargenauigkeit (Steuerrecht S5): Beträge in vollen Euro, kaufmännisch gerundet — ELSTER
 *   fragt die Anlage Gem in vollen Euro ab; der Bericht selbst zeigt Cent, eine eigene Rundung zum Übertragen hat er
 *   nicht. Zeile 9 je Jahr. Freitexte und Namen nur als SHA-256 (Vereinsrecht K1), Kontakt-IDs gar nicht.
 * - **Beilagen** in Cent (F5): EÜR für das Finanzamt je Jahr und Bereich mit den Posten des Zusatzblatts und den
 *   Angaben „nachrichtlich“, Vermögensübersicht je Jahr nach Abschnitt, Rücklagenspiegel je Jahr und Rücklage.
 *
 * Die Berichte laufen über ihre `compute`-Funktionen, ohne Rechteprüfung. Das Abbild steht nie im Protokoll.
 */

export interface TaxFigures {
  /** Je Zeile der Anlage Gem (`'9@2024'` je Jahr) der Wert in Formulargenauigkeit. */
  lines: Record<string, unknown>;
  /** Je Beilage und Jahr (`'assetOverview@2024'`) die Beträge in Cent. */
  attachments: Record<string, unknown>;
}

export type { TaxFigureCause, TaxFiguresAttachment } from '../ledger/tax-periods';

/**
 * Woher die Einstellungen kommen: aus `deps` oder — in der Rechnung eines Berichts (Übergabeliste) — aus dessen
 * Umgebung, die dann die Schlüssel von `TAX_FIGURES_SETTING_KEYS` tragen muss.
 */
export type TaxSettingsSource = Deps | ReportComputeEnv;
/** Die Einstellungen, die die Berichte des Abbilds lesen. */
export const TAX_FIGURES_SETTING_KEYS: readonly string[] = [...new Set([...(taxReturnGemReport.settingKeys ?? []), ...(taxReturnIncomeStatementReport.settingKeys ?? [])])];

/** Die Einstellungen, die der Bericht nennt — wie `reportComputeEnvInternal`, ohne den Katalog zu laden (Übergabeliste und Kassenbericht lesen dieses Modul). */
const envOf = (source: TaxSettingsSource, def: { settingKeys?: readonly string[] }): ReportComputeEnv => ({ settings: Object.fromEntries((def.settingKeys ?? []).map((key) => [key, 'settings' in source ? source.settings[key] : readSetting(source, key)])) });

const euros = (cents: number): number => Math.round(cents / 100);
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
/** In Zeilen von Listen: IDs bleiben, Beträge in Euro, Text als Hash; `contactId` fällt weg (Namen nennt der Hash). */
const KEPT_CELLS = new Set(['reserveId', 'designation']);

function rowOf(row: Record<string, string | number | null>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'contactId') continue;
    if (value === null) out[key] = null;
    else if (key.endsWith('Cents')) out[key] = euros(Number(value));
    else if (KEPT_CELLS.has(key) || typeof value !== 'string') out[key] = value;
    else out[key] = digest(value);
  }
  return out;
}

function valueOf(value: GemValue | null): unknown {
  if (value === null) return null;
  switch (value.kind) {
    case 'yearRange':
      return { from: value.from, to: value.to };
    case 'amount':
      return euros(value.cents);
    case 'yesNo':
      return value.value;
    case 'date':
    case 'choice':
      return value.value;
    case 'text':
      return digest(value.value);
    case 'list':
      return value.rows.map(rowOf);
    case 'elster':
      return 'elster';
    case 'amountPerYear':
      return null;
  }
}

/** Ohne Rechteprüfung: das Abbild des Erklärungszeitraums mit den Daten von heute; `null` für einen unbekannten Zeitraum. */
export function taxFiguresInternal(deps: TaxSettingsSource, db: DbOrTx, taxPeriodId: string): TaxFigures | null {
  const period = taxPeriodInternal(db, taxPeriodId);
  if (!period) return null;
  const params = { taxPeriodId };
  const gem = computeTaxReturnGemReport(db, params, envOf(deps, taxReturnGemReport));
  const designation = new Map(gem.years.map((y) => [y.id, y.designation] as const));
  const lines: Record<string, unknown> = {};
  for (const l of gem.lines) {
    if (l.value?.kind === 'amountPerYear') {
      for (const p of l.value.perYear) lines[`${l.line}@${designation.get(p.fiscalYearId) ?? p.fiscalYearId}`] = euros(p.cents);
    } else lines[l.line] = valueOf(l.value);
  }
  const attachments: Record<string, unknown> = {};
  const income = computeTaxReturnIncomeStatementReport(db, params, envOf(deps, taxReturnIncomeStatementReport));
  for (const y of income.perYear) {
    attachments[`taxReturnIncomeStatement@${designation.get(y.fiscalYearId)}`] = {
      spheres: y.spheres.map((s) => ({ sphere: s.sphere, income: s.income.map((p) => [p.post, p.cents]), incomeCents: s.incomeCents, expenseCents: s.expenseCents, resultCents: s.resultCents })),
      trainer: y.trainer,
      memberCount: y.memberCount,
      confirmedCents: y.confirmedCents,
    };
  }
  for (const id of period.fiscalYearIds) {
    const a = computeAssetOverviewReport(db, { fiscalYearId: id });
    attachments[`assetOverview@${designation.get(id)}`] = {
      accountsCents: a.accountsCents,
      receivablesCents: a.receivablesCents,
      payablesCents: a.payablesCents,
      netAssetsCents: a.netAssetsCents,
      earmarkedCents: a.earmarkedCents,
      reservesCents: a.reservesCents,
      reservesBeyondPurposesCents: a.reservesBeyondPurposesCents,
      freeCents: a.freeCents,
      otherAssetsCents: a.otherAssets.assetsCents,
      otherLiabilitiesCents: a.otherAssets.liabilitiesCents,
    };
  }
  const reserves = computeReserveStatementReport(db, { fiscalYearIds: period.fiscalYearIds });
  for (const id of period.fiscalYearIds) {
    const perReserve: Record<string, unknown> = {};
    for (const r of reserves.reserves) {
      const y = r.perYear.find((p) => p.fiscalYearId === id);
      if (y) perReserve[r.reserveId] = [y.openingCents, y.allocatedCents, y.withdrawnCents, y.dissolvedCents, y.closingCents];
    }
    attachments[`reserveStatement@${designation.get(id)}`] = perReserve;
  }
  return { lines, attachments };
}

/** Ohne Rechteprüfung: das Abbild als JSON zum Festhalten (kanonisch, Schlüssel sortiert). */
export function taxFiguresJsonInternal(deps: Deps, db: DbOrTx, taxPeriodId: string): string | null {
  const figures = taxFiguresInternal(deps, db, taxPeriodId);
  return figures ? canonicalJson(figures) : null;
}

const parseKey = (key: string): { name: string; year?: string } => {
  const at = key.indexOf('@');
  return at < 0 ? { name: key } : { name: key.slice(0, at), year: key.slice(at + 1) };
};

/** Zeilennummer zum Sortieren: „9“ vor „9a“ vor „10“. */
const lineOrder = (line: string): [number, string] => {
  const m = /^(\d+)(.*)$/.exec(line);
  return m ? [Number(m[1]), m[2]!] : [Number.MAX_SAFE_INTEGER, line];
};
const ATTACHMENT_ORDER: readonly TaxFiguresAttachment[] = ['taxReturnIncomeStatement', 'assetOverview', 'reserveStatement'];

/**
 * Rein: die geänderten Stellen zwischen zwei Abbildern — Zeilen der Anlage Gem in der Folge des Formulars, dann die
 * Beilagen je Art und Jahr. Leer bei gleichen Werten.
 */
export function taxFiguresDiffer(a: TaxFigures, b: TaxFigures): TaxFigureCause[] {
  const changed = (x: Record<string, unknown>, y: Record<string, unknown>) => [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => canonicalJson(x[k] ?? null) !== canonicalJson(y[k] ?? null));
  const lines = changed(a.lines, b.lines)
    .map(parseKey)
    .sort((p, q) => {
      const [pn, ps] = lineOrder(p.name);
      const [qn, qs] = lineOrder(q.name);
      return pn - qn || ps.localeCompare(qs) || (q.year ?? '').localeCompare(p.year ?? '');
    })
    .map((p): TaxFigureCause => ({ kind: 'line', line: p.name, ...(p.year ? { year: p.year } : {}) }));
  const attachments = changed(a.attachments, b.attachments)
    .map(parseKey)
    .sort((p, q) => ATTACHMENT_ORDER.indexOf(p.name as TaxFiguresAttachment) - ATTACHMENT_ORDER.indexOf(q.name as TaxFiguresAttachment) || (p.year ?? '').localeCompare(q.year ?? ''))
    .map((p): TaxFigureCause => ({ kind: 'attachment', report: p.name as TaxFiguresAttachment, ...(p.year ? { year: p.year } : {}) }));
  return [...lines, ...attachments];
}

/** Rein: ein festgehaltenes Abbild lesen; unlesbar `null` (dann gilt die Abgabe als ohne Abbild). */
export function parseTaxFigures(json: string | null): TaxFigures | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<TaxFigures>;
    return parsed && typeof parsed.lines === 'object' && typeof parsed.attachments === 'object' ? { lines: parsed.lines ?? {}, attachments: parsed.attachments ?? {} } : null;
  } catch {
    return null;
  }
}

// ── Prüfanlass ─────────────────────────────────────────────────────────────

/** Ohne Rechteprüfung: die Berichtigungen eines Zeitraums, älteste zuerst. */
export function taxAmendmentsOfInternal(db: DbOrTx, taxPeriodId: string): FinanceTaxAmendmentRow[] {
  return db.select().from(financeTaxAmendments).where(eq(financeTaxAmendments.taxPeriodId, taxPeriodId)).orderBy(asc(financeTaxAmendments.at), asc(financeTaxAmendments.id)).all();
}

/** Ohne Rechteprüfung: die Prüfungen eines Zeitraums (ohne Berichtigung, Anzeige), älteste zuerst. */
export function taxChecksOfInternal(db: DbOrTx, taxPeriodId: string): FinanceTaxAmendmentCheckRow[] {
  return db.select().from(financeTaxAmendmentChecks).where(eq(financeTaxAmendmentChecks.taxPeriodId, taxPeriodId)).orderBy(asc(financeTaxAmendmentChecks.at), asc(financeTaxAmendmentChecks.id)).all();
}

/**
 * Ein Eintrag des Verlaufs: die erste Abgabe, eine Berichtigung, eine Prüfung ohne Berichtigung (diese drei sind
 * Maßstäbe, mit Abbild) oder eine Anzeige. `cause` nennt bei Berichtigung und Prüfung, was sich gegenüber dem vorigen
 * Maßstab geändert hatte (für Kassenbericht und Seite); ohne Abbild an einem der beiden leer.
 */
export type TaxHistoryEntry =
  | { kind: 'filing'; at: string; day: string; figures: TaxFigures | null }
  | { kind: 'amendment'; at: string; day: string; figures: TaxFigures | null; row: FinanceTaxAmendmentRow; cause: TaxFigureCause[] }
  | { kind: 'check'; at: string; day: string; figures: TaxFigures | null; row: FinanceTaxAmendmentCheckRow; cause: TaxFigureCause[] }
  | { kind: 'notice'; at: string; day: string; row: FinanceTaxAmendmentCheckRow };

/**
 * Ohne Rechteprüfung, rein aus den festgehaltenen Zeilen: der Verlauf eines abgegebenen Zeitraums in der Folge der
 * Eintragung. Die erste Abgabe steht immer vorn, weil Berichtigung und Prüfung eine Abgabe voraussetzen. Leer, solange
 * der Zeitraum nicht abgegeben ist.
 */
export function taxHistoryInternal(db: DbOrTx, taxPeriodId: string): TaxHistoryEntry[] {
  const row = db.select({ filedOn: financeTaxPeriods.filedOn, filedFigures: financeTaxPeriods.filedFigures }).from(financeTaxPeriods).where(eq(financeTaxPeriods.id, taxPeriodId)).get();
  if (!row?.filedOn) return [];
  const later: { at: string; id: string; make: (previous: TaxFigures | null) => TaxHistoryEntry }[] = [];
  const causeOf = (previous: TaxFigures | null, figures: TaxFigures | null) => (previous && figures ? taxFiguresDiffer(previous, figures) : []);
  for (const a of taxAmendmentsOfInternal(db, taxPeriodId)) {
    const figures = parseTaxFigures(a.figures);
    later.push({ at: a.at, id: a.id, make: (previous) => ({ kind: 'amendment', at: a.at, day: a.filedOn, figures, row: a, cause: causeOf(previous, figures) }) });
  }
  for (const c of taxChecksOfInternal(db, taxPeriodId)) {
    if (c.kind === 'notified') later.push({ at: c.at, id: c.id, make: () => ({ kind: 'notice', at: c.at, day: c.checkedOn, row: c }) });
    else {
      const figures = parseTaxFigures(c.figures);
      later.push({ at: c.at, id: c.id, make: (previous) => ({ kind: 'check', at: c.at, day: c.checkedOn, figures, row: c, cause: causeOf(previous, figures) }) });
    }
  }
  const out: TaxHistoryEntry[] = [{ kind: 'filing', at: '', day: row.filedOn, figures: parseTaxFigures(row.filedFigures) }];
  let reference: TaxFigures | null = (out[0] as { figures: TaxFigures | null }).figures;
  for (const item of later.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    const entry = item.make(reference);
    out.push(entry);
    if (entry.kind !== 'notice') reference = entry.figures;
  }
  return out;
}

type ReferenceEntry = Exclude<TaxHistoryEntry, { kind: 'notice' }>;

export interface TaxReviewState {
  history: TaxHistoryEntry[];
  /** Der Maßstab: der jüngste Eintrag unter Abgaben und Prüfungen ohne Berichtigung; `null`, solange nicht abgegeben. */
  reference: ReferenceEntry | null;
  /** Prüfanlass offen: Die Werte weichen heute vom Maßstab ab (§ 4.2). Ohne Abbild am Maßstab nie. */
  reviewDue: boolean;
  /** Die geänderten Stellen gegenüber dem Maßstab, nur bei offenem Anlass. */
  cause: TaxFigureCause[];
  /** Eine Berichtigung ist eintragbar: Die Werte weichen von der letzten Abgabe ab, oder sie hat kein Abbild (§ 4.3). */
  amendmentAllowed: boolean;
  /** Die Anzeige zum laufenden Anlass (nach dem Maßstab eingetragen), sonst `null`. */
  notice: FinanceTaxAmendmentCheckRow | null;
  notifiedOn: string | null;
  /** Der Tag der letzten Abgabe (erste Abgabe oder jüngste Berichtigung), sonst `null`. */
  lastFiledOn: string | null;
  /** Die jüngste Berichtigung, sonst `null`. */
  lastAmendment: FinanceTaxAmendmentRow | null;
}

/**
 * Ohne Rechteprüfung (Spec 0.5.2 § 4.2/4.3): Maßstab ist der jüngste Eintrag unter den Abgaben (erste Abgabe,
 * Berichtigungen) und den Prüfungen ohne Berichtigung. Rechnet die Werte von heute nur für einen abgegebenen Zeitraum
 * mit Abbild — die vier Berichte, einmal.
 */
export function taxReviewStateInternal(deps: TaxSettingsSource, db: DbOrTx, taxPeriodId: string): TaxReviewState {
  const history = taxHistoryInternal(db, taxPeriodId);
  const references = history.filter((e): e is ReferenceEntry => e.kind !== 'notice');
  const reference = references.at(-1) ?? null;
  const filings = references.filter((e) => e.kind !== 'check');
  const lastFiling = filings.at(-1) ?? null;
  if (!reference || !lastFiling) return { history, reference: null, reviewDue: false, cause: [], amendmentAllowed: false, notice: null, notifiedOn: null, lastFiledOn: null, lastAmendment: null };
  const now = reference.figures !== null || lastFiling.figures !== null ? taxFiguresInternal(deps, db, taxPeriodId) : null;
  const cause = reference.figures && now ? taxFiguresDiffer(reference.figures, now) : [];
  const amendmentAllowed = lastFiling.figures === null || (now !== null && taxFiguresDiffer(lastFiling.figures, now).length > 0);
  const noticeEntry = history.filter((e): e is Extract<TaxHistoryEntry, { kind: 'notice' }> => e.kind === 'notice' && e.at > reference.at).at(-1) ?? null;
  const lastAmendment = lastFiling.kind === 'amendment' ? lastFiling.row : null;
  return { history, reference, reviewDue: cause.length > 0, cause, amendmentAllowed, notice: noticeEntry?.row ?? null, notifiedOn: noticeEntry?.day ?? null, lastFiledOn: lastFiling.day, lastAmendment };
}

const ATTACHMENT_TEXT: Record<TaxFiguresAttachment, string> = { taxReturnIncomeStatement: 'Beilage EÜR', assetOverview: 'Vermögensübersicht', reserveStatement: 'Rücklagenspiegel' };

/**
 * Rein: die geänderten Stellen als Text — „Zeile 9 (2024), Zeile 21, Beilage EÜR 2024, Rücklagenspiegel 2024“. Papier-
 * und Formularbegriffe (Prinzip 7 wie die Betreffe der Akte): für Kassenbericht, Übergabeliste und die Fristzeile.
 */
export function taxCauseText(causes: readonly TaxFigureCause[]): string {
  return causes.map((c) => (c.kind === 'line' ? `Zeile ${c.line}${c.year ? ` (${c.year})` : ''}` : `${ATTACHMENT_TEXT[c.report]}${c.year ? ` ${c.year}` : ''}`)).join(', ');
}
