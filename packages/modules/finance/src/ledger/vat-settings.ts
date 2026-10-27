import { invalid, isoNow, notFound, ok, readSetting, requirePermission, todayIn, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeAllocationLines, financeCategories, financeDatedValues, financeEntries } from '../schema';
import { requireMasterDataRead } from './access';
import { datedValueRemovalImpactInternal, valueAt, writeDatedValueInternal, type DatedValue, type DatedValueRemovalImpact } from './dated-values';
import type { DatedValueKey } from './dated-series';
import { REVERSE_CHARGE_CODES, TAX_CODES } from './codes';
import { taxContextAt, type TaxCode, type Taxation } from './tax';
import { isValidVatId, normalizeVatId } from './vat-id';
import type { VatPeriodKind } from './vat-calendar';
import { vatAdvancePeriodKindInternal } from './vat-periods';
import { FEDERAL_STATES, type FederalState } from './working-days';

export { isValidVatId } from './vat-id';

/**
 * Einstellung „Umsatzsteuer“ (Spec E6 Teil 1, Plan E6a Task 2): die Umsatzsteuer-Lage des Vereins als datierte Werte
 * (`finance_dated_values`), damit ein Wechsel ab einem Tag gilt. In `ledger/`, weil Fristen, Schritt 12 und die
 * Buchungsmasken sie lesen.
 */
export const VAT_DATED_KEYS = ['vatEntrepreneur', 'vatId', 'vatAdvancePeriod', 'vatAdvanceExempt', 'vatPermanentExtension', 'taxOfficeState'] as const satisfies readonly DatedValueKey[];
export type VatAdvancePeriodSetting = 'auto' | 'quarter' | 'month';

export interface VatProfile {
  on: string;
  taxation: Taxation;
  /** Bei `regular` immer `true`. */
  entrepreneur: boolean;
  vatId: string | null;
  advancePeriod: VatAdvancePeriodSetting;
  /** Nur bei `regular` wirksam (UStAE 18.2 Abs. 2: keine Befreiung im Fall des § 18 Abs. 4a). */
  advanceExempt: boolean;
  permanentExtension: boolean;
  taxOfficeState: FederalState | null;
  /**
   * `regular`: Regelbesteuerung; `section18_4a`: Unternehmer, Pflicht nur bei § 13b/Erwerb (§ 18 Abs. 4a UStG);
   * `section18_4aLegalPerson`: kein Unternehmer, aber als juristische Person Steuerschuldner nach § 13b Abs. 5 S. 1 UStG
   * für Abs. 1 (nur mit USt-IdNr., § 3a Abs. 2 S. 3) und Abs. 2 Nr. 1–3, dazu die Erwerbsteuer über der Erwerbsschwelle
   * (§ 1a Abs. 3 Nr. 2, Abs. 5) — Pflicht ebenfalls nach § 18 Abs. 4a, der „juristische Personen“ ausdrücklich nennt
   * (UStAE 13b.1 Abs. 1, 13b.16 Abs. 1; Recherche 2026-10-26, Befund 37).
   */
  obligations: 'section18_4aLegalPerson' | 'section18_4a' | 'regular';
}

export type VatSettingsHint =
  /** Kein Unternehmer: Steuer nur nach § 13b oder für Erwerbe aus der EU (`section18_4aLegalPerson`). */
  | { code: 'notEntrepreneur' }
  /** Kein Unternehmer mit USt-IdNr.: Dienstleistungen aus der EU haben ihren Ort am Sitz (§ 3a Abs. 2 S. 3 UStG). */
  | { code: 'vatIdPlacesEuServices' }
  /** Grund mit Beleg (Befund 27 a): gebuchte Einnahmen in Zweckbetrieb oder wGB im Jahr `year` (laufendes oder voriges). */
  | { code: 'entrepreneurSuggested'; categories: number; names: string[]; year: number; incomeCents: number }
  | { code: 'vatIdRecommended' }
  | { code: 'acquisitionThreshold' }
  | { code: 'specialPrepayment' };

/** Ein eingetragener Stand: die Überschreibungen der sechs Schlüssel an einem Tag. */
export interface VatSettingsStand {
  validFrom: string;
  /** Was an diesem Tag eingetragen ist. */
  values: Partial<Record<(typeof VAT_DATED_KEYS)[number], DatedValue>>;
  /**
   * Was ab diesem Tag gilt (Befund 30 g): ein nicht eingetragener Wert aus dem Stand davor oder als Vorgabe — wie das
   * Formular, das „Automatisch“ und „Nein“ zeigt, wo die Liste sonst „—“ zeigte. Berechnet über `vatProfileAt`.
   */
  effective: Pick<VatProfile, 'entrepreneur' | 'vatId' | 'advancePeriod' | 'permanentExtension'>;
  /** N11 c: was das Entfernen des Stands berührt — für die Rückfrage vor dem Entfernen. */
  removal: DatedValueRemovalImpact;
}

export interface VatSettingsView {
  profile: VatProfile;
  hints: VatSettingsHint[];
  confirmedAt: string | null;
  /** „Unternehmer“ ist ausdrücklich entschieden (Eintrag in der Reihe `vatEntrepreneur` oder `regular`) — sonst ohne Vorauswahl. */
  entrepreneurDecided: boolean;
  /** Ab wann die heutige Besteuerungsform gilt (Zeile „Besteuerung … seit …“); `null` = Vorgabe ohne Eintrag. */
  taxationSince: string | null;
  /** Was „Automatisch“ im Jahr von `on` ergibt. */
  advancePeriodKind: VatPeriodKind;
  /** Die eingetragenen Stände (Überschreibungen der sechs Schlüssel, je Tag gebündelt), neueste zuerst. */
  history: VatSettingsStand[];
}

/** Ohne Rechteprüfung: die Umsatzsteuer-Lage an einem Tag. Widersprüche aus dem allgemeinen Setter wirken nicht. */
export function vatProfileAt(db: DbOrTx, date: string): VatProfile {
  const taxation = (valueAt(db, 'taxation', date) ?? 'smallBusiness') as Taxation;
  const regular = taxation === 'regular';
  const entrepreneur = regular || valueAt(db, 'vatEntrepreneur', date) === true;
  const vatId = valueAt(db, 'vatId', date);
  const state = valueAt(db, 'taxOfficeState', date);
  return {
    on: date,
    taxation,
    entrepreneur,
    vatId: typeof vatId === 'string' && vatId !== '' ? vatId : null,
    advancePeriod: ((valueAt(db, 'vatAdvancePeriod', date) as VatAdvancePeriodSetting | null) ?? 'auto'),
    advanceExempt: regular && valueAt(db, 'vatAdvanceExempt', date) === true,
    permanentExtension: valueAt(db, 'vatPermanentExtension', date) === true,
    taxOfficeState: typeof state === 'string' && (FEDERAL_STATES as readonly string[]).includes(state) ? (state as FederalState) : null,
    obligations: regular ? 'regular' : entrepreneur ? 'section18_4a' : 'section18_4aLegalPerson',
  };
}

/**
 * Was ein Verein ohne Unternehmereigenschaft und ohne USt-IdNr. an einer Zeile kennzeichnen kann: Als juristische Person
 * schuldet er die Steuer für Werklieferungen und übrige sonstige Leistungen ausländischer Unternehmer im Inland (§ 13b
 * Abs. 2 Nr. 1, Abs. 5 S. 1 UStG, Kz 84/85) und über der Erwerbsschwelle die Erwerbsteuer (§ 1a Abs. 3 Nr. 2, Abs. 5,
 * Kz 89/93). § 13b Abs. 1 (Kz 46/47) setzt § 3a Abs. 2 voraus, der ihn nur mit USt-IdNr. erfasst (§ 3a Abs. 2 S. 3).
 * Eigene Umsatzsteuer-Kennzeichen hat er nicht (Befund 37, Recherche 2026-10-26 A.5).
 */
export const LEGAL_PERSON_TAX_CODES = ['rc13bOther', 'icAcquisition'] as const satisfies readonly TaxCode[];

/**
 * Ohne Rechteprüfung: die Steuerkennzeichen der Buchungsmaske — alle für Unternehmer; ohne Unternehmereigenschaft
 * `LEGAL_PERSON_TAX_CODES`, mit USt-IdNr. dazu § 13b Abs. 1 (`rc13bEu`): Dienstleistungen aus der EU haben dann ihren
 * Ort am Sitz (§ 3a Abs. 2 S. 3 UStG). Eigene steuerpflichtige Umsätze hat der Nicht-Unternehmer auch mit USt-IdNr.
 * nicht, also keine eigenen Sätze (Befund 39, Frage 2). `REVERSE_CHARGE_CODES` hat dieselbe Reihenfolge.
 */
export function taxCodeOptionsInternal(db: DbOrTx, date: string): TaxCode[] {
  const profile = vatProfileAt(db, date);
  if (profile.entrepreneur) return [...TAX_CODES];
  return profile.vatId !== null ? [...REVERSE_CHARGE_CODES] : [...LEGAL_PERSON_TAX_CODES];
}

/**
 * Gebuchte Einnahmen im Zweckbetrieb oder wirtschaftlichen Geschäftsbetrieb — Grund für den Vorschlag „Unternehmer“
 * (UStAE 2.10; Befund 27 a: aktive Kategorien allein reichen nicht, der Startplan hat sie in jeder Installation).
 * Festgeschrieben, nicht zurückgenommen und keine Rücknahme, ohne `thresholdExclusion` (die Erstattung von Umsatzsteuer
 * ist keine Leistung); im Kalenderjahr von `on`, ist dort nichts, im Vorjahr.
 */
function entrepreneurEvidence(db: DbOrTx, on: string): { categories: number; names: string[]; year: number; incomeCents: number } | null {
  const ofYear = (year: number) =>
    db
      .select({ name: financeCategories.name, amountCents: financeAllocationLines.amountCents })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
      .where(
        and(
          eq(financeEntries.status, 'final'),
          isNull(financeEntries.reversedByEntryId),
          isNull(financeEntries.reversesEntryId),
          gte(financeEntries.entryDate, `${year}-01-01`),
          lte(financeEntries.entryDate, `${year}-12-31`),
          eq(financeCategories.direction, 'income'),
          inArray(financeCategories.sphere, ['purposeOperation', 'business']),
          eq(financeCategories.thresholdExclusion, 'none'),
        ),
      )
      .all();
  const year = Number(on.slice(0, 4));
  for (const y of [year, year - 1]) {
    const rows = ofYear(y);
    const incomeCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
    if (rows.length === 0 || incomeCents <= 0) continue;
    const names = [...new Set(rows.map((r) => r.name))].sort((a, b) => a.localeCompare(b, 'de'));
    return { categories: names.length, names, year: y, incomeCents };
  }
  return null;
}

/** Ohne Rechteprüfung: die Hinweise am Tag `on`. `monthly` sagt, ob der Zeitraum an dem Tag ein Monat ist. */
export function vatSettingsHintsInternal(db: DbOrTx, profile: VatProfile, monthly: boolean): VatSettingsHint[] {
  const hints: VatSettingsHint[] = [];
  if (profile.obligations === 'section18_4aLegalPerson') hints.push({ code: 'notEntrepreneur' });
  // § 3a Abs. 2 S. 3 UStG, UStAE 3a.2 Abs. 7: Die juristische Person mit USt-IdNr. steht einem Unternehmer gleich.
  if (profile.obligations === 'section18_4aLegalPerson' && profile.vatId !== null) hints.push({ code: 'vatIdPlacesEuServices' });
  if (!profile.entrepreneur) {
    const evidence = entrepreneurEvidence(db, profile.on);
    if (evidence) hints.push({ code: 'entrepreneurSuggested', ...evidence });
  }
  if (profile.entrepreneur && profile.vatId === null) hints.push({ code: 'vatIdRecommended' });
  // § 1a Abs. 4 UStG: Wer die USt-IdNr. gegenüber einem Warenlieferanten verwendet, verzichtet auf die Erwerbsschwelle.
  if (profile.vatId !== null) hints.push({ code: 'acquisitionThreshold' });
  // § 47 UStDV: Bei monatlicher Abgabe verlangt die Dauerfristverlängerung eine Sondervorauszahlung.
  if (profile.obligations === 'regular' && monthly && profile.permanentExtension) hints.push({ code: 'specialPrepayment' });
  return hints;
}

/** Die Überschreibungen der sechs Schlüssel, je Tag gebündelt, neueste zuerst (ohne ausgelieferte Reihen). */
function effectiveAt(db: DbOrTx, day: string): VatSettingsStand['effective'] {
  const p = vatProfileAt(db, day);
  return { entrepreneur: p.entrepreneur, vatId: p.vatId, advancePeriod: p.advancePeriod, permanentExtension: p.permanentExtension };
}

function historyInternal(db: DbOrTx): VatSettingsStand[] {
  const rows = db.select().from(financeDatedValues).where(inArray(financeDatedValues.key, [...VAT_DATED_KEYS])).orderBy(asc(financeDatedValues.validFrom)).all();
  const byDay = new Map<string, VatSettingsStand>();
  for (const row of rows) {
    const stand = byDay.get(row.validFrom) ?? { validFrom: row.validFrom, values: {}, effective: effectiveAt(db, row.validFrom), removal: { validFrom: row.validFrom, nextFrom: null, finalizedEntries: 0 } };
    stand.values[row.key as (typeof VAT_DATED_KEYS)[number]] = JSON.parse(row.value) as DatedValue;
    byDay.set(row.validFrom, stand);
  }
  for (const stand of byDay.values()) stand.removal = datedValueRemovalImpactInternal(db, Object.keys(stand.values) as DatedValueKey[], stand.validFrom);
  return [...byDay.values()].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

/**
 * Seit wann der Wert von `key` am Tag `on` ununterbrochen gilt: der früheste Eintrag des Vereins, ab dem bis `on`
 * derselbe Wert gilt — die ausgelieferte Vorgabe (2000) zählt nicht als Beginn. Ohne Eintrag bis `on`: `null`.
 */
function sinceInternal(db: DbOrTx, key: DatedValueKey, on: string): string | null {
  const current = valueAt(db, key, on);
  const points = db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(and(eq(financeDatedValues.key, key), lte(financeDatedValues.validFrom, on))).all().map((r) => r.validFrom).sort().reverse();
  let since: string | null = null;
  for (const point of points) {
    if (valueAt(db, key, point) !== current) break;
    since = point;
  }
  return since;
}

/** Ohne Rechteprüfung: seit wann der Verein am Tag `on` Unternehmer ist (Eintrag oder Regelbesteuerung), sonst `null`. */
export function entrepreneurSinceInternal(db: DbOrTx, on: string): string | null {
  const profile = vatProfileAt(db, on);
  if (!profile.entrepreneur) return null;
  if (valueAt(db, 'vatEntrepreneur', on) === true) return sinceInternal(db, 'vatEntrepreneur', on);
  return sinceInternal(db, 'taxation', on);
}

/** Ohne Rechteprüfung: die Sicht auf die Einstellung am Tag `on`. */
function viewAt(deps: Deps, db: DbOrTx, on: string): VatSettingsView {
  const profile = vatProfileAt(db, on);
  const decided = profile.taxation === 'regular' || db.select({ validFrom: financeDatedValues.validFrom }).from(financeDatedValues).where(and(eq(financeDatedValues.key, 'vatEntrepreneur'), lte(financeDatedValues.validFrom, on))).get() !== undefined;
  const kind = vatAdvancePeriodKindInternal(db, Number(on.slice(0, 4)));
  return {
    profile,
    hints: vatSettingsHintsInternal(db, profile, kind === 'month'),
    confirmedAt: readSetting<string | null>({ ...deps, db }, 'finance.setupVatConfirmedAt'),
    entrepreneurDecided: decided,
    taxationSince: sinceInternal(db, 'taxation', on),
    advancePeriodKind: kind,
    history: historyInternal(db),
  };
}

/**
 * Ohne Rechteprüfung: für den Satz unter der Buchungszeile — Besteuerung und Sätze von `today` (Entscheidung 19:
 * ein Satzwechsel im Jahr ist für die Vorschau nicht abgebildet) und die Zeitraumart für Vorjahr, Jahr und Folgejahr.
 */
export function vatLineContextInternal(db: DbOrTx, today: string): { taxation: Taxation; rates: { standard: number; reduced: number }; periodKinds: Record<number, VatPeriodKind> } {
  const context = taxContextAt(db, today) ?? { taxation: 'smallBusiness' as Taxation, rates: { standard: 0, reduced: 0 } };
  const year = Number(today.slice(0, 4));
  const periodKinds: Record<number, VatPeriodKind> = {};
  for (const y of [year - 1, year, year + 1]) periodKinds[y] = vatAdvancePeriodKindInternal(db, y);
  return { taxation: context.taxation, rates: context.rates, periodKinds };
}

const getSchema = z.object({ on: z.iso.date().optional() }).strict();

/** `finance.overview`, `finance.read` oder `finance.setup`: die Einstellung an einem Tag (Vorgabe heute) mit Hinweisen. */
export async function getVatSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatSettingsView>> {
  const denied = requireMasterDataRead(ctx).failure;
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(viewAt(deps, deps.db, parsed.value.on ?? todayIn(deps)));
}

const saveSchema = z
  .object({
    validFrom: z.iso.date(),
    vatEntrepreneur: z.boolean().optional(),
    /** Leer = „keine ab diesem Tag“. */
    vatId: z.string().max(20).optional(),
    vatAdvancePeriod: z.enum(['auto', 'quarter', 'month']).optional(),
    vatAdvanceExempt: z.boolean().optional(),
    vatPermanentExtension: z.boolean().optional(),
    /** Leer oder `null` = nur bundesweite Feiertage. */
    taxOfficeState: z.union([z.enum(FEDERAL_STATES), z.literal('')]).nullable().optional(),
  })
  .strict();

/**
 * `finance.setup`: die genannten Werte ab `validFrom` setzen — je Wert ein datierter Eintrag mit Protokoll
 * `finance.datedValue.set` (der vorhandene Mechanismus, keine eigene Aktion) — und den Einrichtungsschritt `vat`
 * bestätigen. Abgelehnt: „kein Unternehmer“ unter `regular` (`regularImpliesEntrepreneur`), Befreiung ohne `regular`
 * (`regularOnly`), eine USt-IdNr. mit falscher Prüfziffer (`invalidVatId`), nichts zu speichern (`nothingToSave`).
 */
export async function saveVatSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatSettingsView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const values: [DatedValueKey, DatedValue][] = [];
  if (v.vatEntrepreneur !== undefined) values.push(['vatEntrepreneur', v.vatEntrepreneur]);
  if (v.vatId !== undefined) values.push(['vatId', normalizeVatId(v.vatId)]);
  if (v.vatAdvancePeriod !== undefined) values.push(['vatAdvancePeriod', v.vatAdvancePeriod]);
  if (v.vatAdvanceExempt !== undefined) values.push(['vatAdvanceExempt', v.vatAdvanceExempt]);
  if (v.vatPermanentExtension !== undefined) values.push(['vatPermanentExtension', v.vatPermanentExtension]);
  if (v.taxOfficeState !== undefined) values.push(['taxOfficeState', v.taxOfficeState ?? '']);
  if (values.length === 0) return invalid([{ path: 'validFrom', message: 'nothingToSave' }]);
  const regular = valueAt(deps.db, 'taxation', v.validFrom) === 'regular';
  const issues: { path: string; message: string }[] = [];
  if (v.vatEntrepreneur === false && regular) issues.push({ path: 'vatEntrepreneur', message: 'regularImpliesEntrepreneur' });
  if (v.vatAdvanceExempt === true && !regular) issues.push({ path: 'vatAdvanceExempt', message: 'regularOnly' });
  const vatId = v.vatId === undefined ? undefined : normalizeVatId(v.vatId);
  if (vatId !== undefined && vatId !== '' && !isValidVatId(vatId)) issues.push({ path: 'vatId', message: 'invalidVatId' });
  if (issues.length > 0) return invalid(issues);
  return deps.db.transaction((tx: DbOrTx) => {
    for (const [key, value] of values) writeDatedValueInternal(tx, deps, ctx, key, v.validFrom, value);
    const written = writeSettingInternal(tx, deps, ctx, 'finance.setupVatConfirmedAt', isoNow(deps.clock), 'finance.setup.setting');
    if (!written.ok) return written;
    return ok(viewAt(deps, tx, todayIn(deps)));
  });
}

const removeSchema = z.object({ validFrom: z.iso.date() }).strict();

/** `finance.setup`, N11 c: die Vorschau vor `removeVatSettings` — welche festgeschriebenen Buchungen der Stand betrifft. */
export async function previewVatSettingsRemoval(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DatedValueRemovalImpact>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, removeSchema, input);
  if (!parsed.ok) return parsed;
  const { validFrom } = parsed.value;
  const keys = deps.db.select({ key: financeDatedValues.key }).from(financeDatedValues).where(and(inArray(financeDatedValues.key, [...VAT_DATED_KEYS]), eq(financeDatedValues.validFrom, validFrom))).all().map((r) => r.key as DatedValueKey);
  if (keys.length === 0) return notFound('vatSettings', validFrom);
  return ok(datedValueRemovalImpactInternal(deps.db, keys, validFrom));
}

/**
 * `finance.setup`: einen Stand entfernen — alle Überschreibungen der sechs Schlüssel an diesem Tag in einer Transaktion,
 * je Wert protokolliert als `finance.datedValue.remove` (der vorhandene Mechanismus, keine eigene Aktion; Entscheidung
 * 21). Danach gilt wieder der vorige Stand. Ohne Eintrag an dem Tag: `notFound`.
 */
export async function removeVatSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<VatSettingsView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, removeSchema, input);
  if (!parsed.ok) return parsed;
  const { validFrom } = parsed.value;
  const rows = deps.db.select().from(financeDatedValues).where(and(inArray(financeDatedValues.key, [...VAT_DATED_KEYS]), eq(financeDatedValues.validFrom, validFrom))).all();
  if (rows.length === 0) return notFound('vatSettings', validFrom);
  return deps.db.transaction((tx: DbOrTx) => {
    for (const row of rows) {
      tx.delete(financeDatedValues).where(and(eq(financeDatedValues.key, row.key), eq(financeDatedValues.validFrom, validFrom))).run();
      financeAudit(tx, deps, ctx, { action: 'finance.datedValue.remove', entity: 'financeDatedValue', id: `${row.key}@${validFrom}`, before: { key: row.key, validFrom, value: JSON.parse(row.value) as DatedValue }, params: { key: row.key, fromOn: validFrom } });
    }
    return ok(viewAt(deps, tx, todayIn(deps)));
  });
}
