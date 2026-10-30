import { expectedVersionField, invalid, isoNow, notFound, ok, requirePermission, staleVersion, timeZoneOf, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles, contacts, displayName } from '@kompass/module-contacts';
import { getDocumentRecord, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, inArray, isNull, lte, or, gte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { financeAssemblyDischarges, financeAssemblyResults, financeAuditReports, financeFiscalYears, type FinanceFiscalYearRow } from '../schema';
import { formerlyGovernedAssemblyOf, governedAssemblyOf } from '../sources';
import { zonedDayOf } from '../zoned-days';
import type { AssemblyResultView, AssemblyWarning, DischargeOutcome } from './types';

export type { AssemblyResultView, DischargeOutcome } from './types';

/**
 * Rechenschaft C Schritt 11 (Spec § C, Claude): Kompass nimmt das **Ergebnis** der Mitgliederversammlung auf —
 * Entlastung erteilt / verweigert / vertagt, einzeln oder gesamt, dazu optional „Jahresrechnung genehmigt“. Verweigert
 * oder vertagt lässt den Schritt offen, ohne etwas zu sperren.
 */

/** Wer im Jahr Vorstand oder Schatzmeister war; `since`/`until` nur, wenn innerhalb des Jahres (sonst `null`). */
export interface AssemblyPerson {
  contactId: string;
  name: string;
  office: string | null;
  since: string | null;
  until: string | null;
}

const ROLES = ['board-member', 'treasurer'] as const;

/**
 * Zusätzliche Personen und Zeiträume aus abgeschlossenen Amtsübergaben des Jahres — eingetragen von `handover.ts`
 * (Von bis zum Übergabetag, An ab dem Tag danach), damit die Entlastung getrennt läuft.
 */
export type AssemblyPersonSource = (db: DbOrTx, year: FinanceFiscalYearRow) => { contactId: string; since?: string; until?: string }[];
const extraSources: AssemblyPersonSource[] = [];
export function registerAssemblyPersonSource(source: AssemblyPersonSource): void {
  if (!extraSources.includes(source)) extraSources.push(source);
}

export function assemblyPersonsInternal(db: DbOrTx, year: FinanceFiscalYearRow): AssemblyPerson[] {
  const roles = db
    .select()
    .from(contactRoles)
    .where(and(inArray(contactRoles.role, [...ROLES]), lte(contactRoles.since, year.endsOn), or(isNull(contactRoles.until), gte(contactRoles.until, year.startsOn))))
    .all();
  const periods = new Map<string, { since: string | null; until: string | null; office: string | null }>();
  const merge = (contactId: string, since: string | null, until: string | null, office: string | null) => {
    const inner = { since: since !== null && since > year.startsOn ? since : null, until: until !== null && until < year.endsOn ? until : null };
    const known = periods.get(contactId);
    if (!known) {
      periods.set(contactId, { ...inner, office });
      return;
    }
    // Mehrere Zeiträume: der früheste Beginn und das späteste Ende; `null` heißt Jahresbeginn bzw. -ende.
    known.since = known.since === null || inner.since === null ? null : known.since < inner.since ? known.since : inner.since;
    known.until = known.until === null || inner.until === null ? null : known.until > inner.until ? known.until : inner.until;
    known.office = known.office ?? office;
  };
  for (const r of roles) merge(r.contactId, r.since, r.until, r.role === 'board-member' ? r.note : null);
  // Übergaben grenzen ein: Von endet am Übergabetag, An beginnt am Tag danach (getrennte Entlastung).
  for (const source of extraSources) {
    for (const p of source(db, year)) {
      const known = periods.get(p.contactId);
      const since = p.since !== undefined && p.since > year.startsOn ? p.since : null;
      const until = p.until !== undefined && p.until < year.endsOn ? p.until : null;
      if (!known) periods.set(p.contactId, { since, until, office: null });
      else if (until !== null && (known.until === null || known.until > until)) known.until = until;
    }
  }
  if (periods.size === 0) return [];
  const people = db.select().from(contacts).where(inArray(contacts.id, [...periods.keys()])).all();
  return people
    .map((c) => ({ contactId: c.id, name: displayName(c), ...periods.get(c.id)! }))
    .map(({ contactId, name, office, since, until }) => ({ contactId, name, office, since, until }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function loadYear(db: DbOrTx, id: string): FinanceFiscalYearRow | null {
  return db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get() ?? null;
}

type AssemblyCore = Pick<AssemblyResultView, 'assemblyOn' | 'minutesDocumentId' | 'minutesDocumentIds' | 'accountsApproved' | 'dischargeMode' | 'collectiveOutcome' | 'discharges' | 'version' | 'updatedAt' | 'updatedByUserId' | 'managed'> & { sourceWarnings?: AssemblyWarning[] };

/**
 * Das Ergebnis eines Jahres mit Zählung, ohne Rechteprüfung — `null` ohne Eintrag. Zuerst die registrierte Quelle
 * (Gremien, G7): Liefert sie etwas, gilt das, egal in welcher Reihenfolge Abschluss und MV liegen; die Tabellen der
 * Finanzen bleiben dann unberührt (Anti-Ziel 1 der Spec Gremien). Sonst das von Hand gespeicherte Ergebnis.
 * `timeZone`: der Prüfbericht ist ein Zeitstempel — verglichen wird sein Tag in der Zone des Vereins (F-B3).
 */
export function assemblyOfYearInternal(deps: Deps, db: DbOrTx, fiscalYearId: string, timeZone: string): AssemblyResultView | null {
  const year = loadYear(db, fiscalYearId);
  if (!year) return null;
  const governed = governedAssemblyOf(deps, db, year);
  if (governed) {
    const { source, warnings: sourceWarnings, ...rest } = governed;
    return withCounts(db, fiscalYearId, timeZone, { ...rest, sourceWarnings, version: year.updatedAt, updatedAt: year.updatedAt, updatedByUserId: null, managed: source });
  }
  const row = db.select().from(financeAssemblyResults).where(eq(financeAssemblyResults.fiscalYearId, fiscalYearId)).get();
  if (!row) return null;
  const stored = new Map(db.select().from(financeAssemblyDischarges).where(eq(financeAssemblyDischarges.fiscalYearId, fiscalYearId)).all().map((d) => [d.contactId, d]));
  const individual = row.dischargeMode === 'individual';
  const discharges = individual ? assemblyPersonsInternal(db, year).map((p) => ({ contactId: p.contactId, outcome: stored.get(p.contactId)?.outcome ?? null, decidedOn: stored.get(p.contactId)?.decidedOn ?? null })) : [];
  return withCounts(db, fiscalYearId, timeZone, {
    assemblyOn: row.assemblyOn,
    minutesDocumentId: row.minutesDocumentId,
    accountsApproved: row.accountsApproved,
    dischargeMode: row.dischargeMode,
    collectiveOutcome: row.collectiveOutcome,
    discharges,
    version: row.updatedAt,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
    managed: null,
  });
}

function withCounts(db: DbOrTx, fiscalYearId: string, timeZone: string, { sourceWarnings = [], ...core }: AssemblyCore): AssemblyResultView {
  const individual = core.dischargeMode === 'individual';
  const granted = individual ? core.discharges.filter((d) => d.outcome === 'granted').length : core.collectiveOutcome === 'granted' ? 1 : 0;
  const total = individual ? core.discharges.length : 1;
  // Hinweis, keine Sperre (Entscheidung c): Liegt die MV vor dem abgelegten Prüfbericht, stimmt meist das Datum nicht.
  // Verglichen wird mit dem Bericht, nicht mit einem Nachtrag — der folgt bei einer Nachprüfung der MV.
  const report = db.select({ filedAt: financeAuditReports.filedAt }).from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), eq(financeAuditReports.kind, 'report'), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt)).get();
  const auditReportFiledAt = report?.filedAt ?? null;
  const warnings: AssemblyWarning[] = auditReportFiledAt && core.assemblyOn < zonedDayOf(auditReportFiledAt, timeZone) ? ['assemblyBeforeAuditReport'] : [];
  warnings.push(...sourceWarnings);
  return { fiscalYearId, ...core, warnings, auditReportFiledAt, granted, total, complete: total > 0 && granted === total };
}

const yearSchema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.read`: das Ergebnis der MV zum Jahr und die Personen, über deren Entlastung sie entscheidet. */
export async function getAssemblyResult(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ result: AssemblyResultView | null; persons: AssemblyPerson[]; formerlyManaged: { label: string } | null }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, yearSchema, input);
  if (!parsed.ok) return parsed;
  const year = loadYear(deps.db, parsed.value.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok({ result: assemblyOfYearInternal(deps, deps.db, year.id, timeZoneOf(deps)), persons: assemblyPersonsInternal(deps.db, year), formerlyManaged: formerlyGovernedAssemblyOf(deps, deps.db, year) });
}

const outcome = z.enum(['granted', 'refused', 'postponed']);
const saveSchema = z.object({
  fiscalYearId: z.string().min(1),
  assemblyOn: z.string().date(),
  minutesDocumentId: z.string().min(1).nullable().optional(),
  accountsApproved: z.enum(['yes', 'no', 'notVoted']).nullable().optional(),
  dischargeMode: z.enum(['individual', 'collective']),
  collectiveOutcome: outcome.nullable().optional(),
  /** Nur bei Einzelentlastung; ein Ergebnis darf offen bleiben (keine Vorwahl). */
  discharges: z.array(z.object({ contactId: z.string().min(1), outcome: outcome.nullable() })).max(100).optional(),
  expectedVersion: expectedVersionField,
});

/**
 * `finance.periodClose`, **`humanOnly`** (persönliche Erklärung): das Ergebnis der MV zu einem abgeschlossenen Jahr
 * speichern. Ändert sich das Ergebnis einer Person, bekommt sie den Tag dieser MV (`decidedOn`); sonst bleibt ihr Tag
 * (Nachtrag aus einer späteren MV, Claude).
 */
export async function saveAssemblyResult(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssemblyResultView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = loadYear(deps.db, v.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  // Führt Gremien das Ergebnis, ändert es sich nur dort — auch im offenen Jahr (G7, vor der Prüfung „abgeschlossen“).
  const governed = governedAssemblyOf(deps, deps.db, year);
  if (governed) return financeConflict('assemblyManagedByGovernance', { label: governed.source.label });
  if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') return financeConflict('assemblyYearOpen', { designation: year.designation });
  if (v.assemblyOn <= year.endsOn) return invalid([{ path: 'assemblyOn', message: 'notAfterYearEnd' }]);
  if (v.assemblyOn > todayIn(deps)) return invalid([{ path: 'assemblyOn', message: 'inFuture' }]);
  const persons = new Set(assemblyPersonsInternal(deps.db, year).map((p) => p.contactId));
  const discharges = v.dischargeMode === 'individual' ? (v.discharges ?? []) : [];
  const stranger = discharges.findIndex((d) => !persons.has(d.contactId));
  if (stranger >= 0) return invalid([{ path: `discharges.${stranger}.contactId`, message: 'notBoardOfYear' }]);
  if (v.minutesDocumentId) {
    const doc = await getDocumentRecord(deps, ctx, v.minutesDocumentId);
    if (!doc.ok) return doc;
    if (doc.value.typeKey !== 'minutes' || doc.value.phase !== 'issued' || doc.value.status === 'voided') return invalid([{ path: 'minutesDocumentId', message: 'notMinutes' }]);
  }
  const before = deps.db.select().from(financeAssemblyResults).where(eq(financeAssemblyResults.fiscalYearId, year.id)).get();
  if (before) {
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }

  // Was vorher galt, für das Protokoll beim Überschreiben (V-7).
  const was = before ? assemblyOfYearInternal(deps, deps.db, year.id, timeZoneOf(deps)) : null;
  const auditView = (r: AssemblyResultView) => ({ fiscalYearId: year.id, assemblyOn: r.assemblyOn, dischargeMode: r.dischargeMode, accountsApproved: r.accountsApproved, granted: r.granted, total: r.total, minutesDocumentId: r.minutesDocumentId });

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const fields = {
      assemblyOn: v.assemblyOn,
      minutesDocumentId: v.minutesDocumentId === undefined ? (before?.minutesDocumentId ?? null) : v.minutesDocumentId,
      accountsApproved: v.accountsApproved ?? null,
      dischargeMode: v.dischargeMode,
      collectiveOutcome: v.dischargeMode === 'collective' ? (v.collectiveOutcome ?? null) : null,
      updatedAt: now,
      updatedByUserId: ctx.userId ?? 'system',
    };
    if (before) tx.update(financeAssemblyResults).set(fields).where(eq(financeAssemblyResults.fiscalYearId, year.id)).run();
    else tx.insert(financeAssemblyResults).values({ fiscalYearId: year.id, ...fields }).run();
    for (const d of discharges) {
      const known = tx.select().from(financeAssemblyDischarges).where(and(eq(financeAssemblyDischarges.fiscalYearId, year.id), eq(financeAssemblyDischarges.contactId, d.contactId))).get();
      const decidedOn = d.outcome === null ? null : known && known.outcome === d.outcome ? known.decidedOn : v.assemblyOn;
      if (known) tx.update(financeAssemblyDischarges).set({ outcome: d.outcome, decidedOn, updatedAt: now }).where(and(eq(financeAssemblyDischarges.fiscalYearId, year.id), eq(financeAssemblyDischarges.contactId, d.contactId))).run();
      else tx.insert(financeAssemblyDischarges).values({ fiscalYearId: year.id, contactId: d.contactId, outcome: d.outcome, decidedOn, updatedAt: now }).run();
    }
    const view = assemblyOfYearInternal(deps, tx, year.id, timeZoneOf(deps))!;
    const open = view.dischargeMode === 'individual' ? view.discharges.filter((d) => d.outcome === null).length : view.collectiveOutcome === null ? 1 : 0;
    financeAudit(tx, deps, ctx, { action: 'finance.assembly.save', entity: 'financeAssemblyResult', id: year.id, ...(was ? { before: auditView(was) } : {}), after: auditView(view), params: { designation: year.designation, dischargeMode: v.dischargeMode, granted: view.granted, open } });
    return ok(view);
  });
}

const minutesSchema = z.object({ fiscalYearId: z.string().min(1), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional() });

/** Höchstgröße des Protokolls, wie beim Scan des Prüfberichts. */
const MINUTES_MAX_BYTES = 10 * 1024 * 1024;

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

/** `finance.periodClose`, **`humanOnly`**: das Protokoll der MV als PDF (Art `minutes`) am Geschäftsjahr ablegen. */
export async function fileAssemblyMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssemblyResultView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, minutesSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > MINUTES_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const year = loadYear(deps.db, v.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  const result = assemblyOfYearInternal(deps, deps.db, year.id, timeZoneOf(deps));
  if (!result) return financeConflict('assemblyNotRecorded', { designation: year.designation });
  // Führt Gremien das Ergebnis, gehört das Protokoll zur Sitzung dort (G7).
  if (result.managed) return financeConflict('assemblyManagedByGovernance', { label: result.managed.label });
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: 'minutes',
    subject: `Protokoll der Mitgliederversammlung zum Geschäftsjahr ${year.designation}`,
    documentDate: result.assemblyOn,
    links: [{ entityType: 'financeFiscalYear', entityId: year.id }],
    afterReceive: (tx, doc) => {
      tx.update(financeAssemblyResults).set({ minutesDocumentId: doc.id, updatedAt: isoNow(deps.clock), updatedByUserId: ctx.userId ?? 'system' }).where(eq(financeAssemblyResults.fiscalYearId, year.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.assembly.minutesFile', entity: 'financeAssemblyResult', id: year.id, after: { fiscalYearId: year.id, minutesDocumentId: doc.id }, params: { designation: year.designation, documentNumber: doc.number ?? '' } });
      return assemblyOfYearInternal(deps, tx, year.id, timeZoneOf(deps))!;
    },
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}
