import { hasPermission, invalid, isoNow, notFound, ok, readSetting, requirePermission, resolveRecordLabel, schema, timeZoneOf, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { auditorsOfYearInternal } from '../auditing/access';
import { lastFiledReportInternal } from '../auditing/report';
import { addDaysInternal, partnerProofDeadlinesInternal } from '../allocation/partner-proof';
import { countToCorrectInternal } from '../donations/to-correct';
import { noticeExpiryInternal } from '../donations/notices';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { fundsUseChainInternal } from '../reporting/funds-use-inputs';
import { taxPeriodsInternal } from '../ledger/tax-periods';
import { vatPeriodViewsInternal } from '../ledger/vat-filings';
import { vatFilingOpensOn } from '../ledger/vat-calendar';
import { financeAllocationLines, financeEntries, financeFiscalYears, financePartnerNotices, financePartnerPayments, financePartnerProfiles, type FinanceFiscalYearRow } from '../schema';
import { assemblyOfYearInternal } from './assembly';

/**
 * Rechenschaft C Finanzfristen (Spec § C, Finanz-Spec § 9.7): sichtbar getrennt die **berechneten** Fristen — ohne
 * Häkchen, mit Link, sie verschwinden, wenn erledigt — und die **Wiedervorlagen** an Finanz-Entitäten. Vorschläge für
 * Wiedervorlagen setzt der Mensch selbst (kein geplantes MV-Datum, Joe 2026-10-24).
 */
export type DeadlineKind = 'noticeExpiry' | 'partnerProof' | 'recipientNoticeExpiry' | 'confirmationsToCorrect' | 'auditorAccess' | 'vatAdvanceReturn' | 'vatReturn' | 'vatAmendment' | 'taxReturn' | 'timelyUse' | 'timelyUseLapsed';
export interface DeadlineView {
  key: string;
  kind: DeadlineKind;
  dueOn: string | null;
  overdue: boolean;
  params: Record<string, string | number>;
  href: string;
  /** N26: bei Voranmeldung und Jahreserklärung der erste Tag, an dem die Abgabe geht (`vatFilingOpensOn`). */
  fileableFrom?: string;
}
export interface FinanceFollowUpView {
  id: string;
  entityType: string;
  entityId: string;
  dueAt: string;
  title: string;
  titleHidden: boolean;
  doneAt: string | null;
}
export interface FinanceDeadlines {
  computed: DeadlineView[];
  followUps: FinanceFollowUpView[] | null;
  suggestions: { key: 'closeBeforeAssembly'; fiscalYearId: string; designation: string }[];
}

/** Wiedervorlagen an diesen Entitäten gehören zu den Finanzen (Plan C1 Task 10). */
export const FINANCE_FOLLOW_UP_ENTITIES = ['financeFiscalYear', 'financeNotice', 'financeAuditReport', 'financeHandover', 'financePartner', 'financeEntry', 'financeTaxPeriod'] as const;

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}


const nameOfContact = (db: DbOrTx, id: string) => {
  const c = db.select().from(contacts).where(eq(contacts.id, id)).get();
  return c ? displayName(c) : '';
};

/** Die berechneten Fristen, ohne Rechteprüfung; Namen nur, wenn `withNames` (`finance.read`). */
export function computedDeadlinesInternal(deps: Deps, today: string, withNames: boolean): DeadlineView[] {
  const db = deps.db;
  const out: DeadlineView[] = [];
  const push = (d: Omit<DeadlineView, 'overdue'>, overdue?: boolean) => out.push({ ...d, overdue: overdue ?? (d.dueOn !== null && d.dueOn < today) });

  const expiry = noticeExpiryInternal(db, today, readSetting<number>(deps, 'finance.noticeExpiryWarnMonths'));
  if (expiry) push({ key: `noticeExpiry:${expiry.noticeId}`, kind: 'noticeExpiry', dueOn: expiry.validUntil, params: {}, href: '/finance/donations/notices' });

  // „Überfällig“ erst nach der Kulanzfrist (`finance.proofGraceDays`), wie in der Partnerliste (E6a, Befund 19).
  const graceDays = readSetting<number>(deps, 'finance.proofGraceDays');
  for (const p of partnerProofDeadlinesInternal(db, today, graceDays)) {
    const payment = db.select({ number: financePartnerPayments.number }).from(financePartnerPayments).where(eq(financePartnerPayments.id, p.paymentId)).get();
    const partner = db.select({ contactId: financePartnerProfiles.contactId }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get();
    push({ key: `partnerProof:${p.paymentId}`, kind: 'partnerProof', dueOn: p.proofDueOn, params: { number: payment?.number ?? '', ...(withNames && partner ? { partner: nameOfContact(db, partner.contactId) } : {}) }, href: `/finance/partners/${p.partnerId}` }, p.overdue);
  }

  // Der jüngste gültige Bescheid je aktivem Partner, der binnen sechs Monaten abläuft (oder abgelaufen ist).
  const horizon = addMonths(today, 6);
  for (const partner of db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.isActive, true)).all()) {
    const latest = db.select().from(financePartnerNotices).where(and(eq(financePartnerNotices.partnerId, partner.id), isNull(financePartnerNotices.voidedAt), isNull(financePartnerNotices.supersededOn))).orderBy(desc(financePartnerNotices.noticeDate)).get();
    if (!latest?.validUntil || latest.validUntil > horizon) continue;
    push({ key: `recipientNoticeExpiry:${latest.id}`, kind: 'recipientNoticeExpiry', dueOn: latest.validUntil, params: withNames ? { partner: nameOfContact(db, partner.contactId) } : {}, href: `/finance/partners/${partner.id}` });
  }

  const toCorrect = countToCorrectInternal(db);
  if (toCorrect > 0) push({ key: 'confirmationsToCorrect', kind: 'confirmationsToCorrect', dueOn: null, params: { count: toCorrect }, href: '/finance/donations' });

  const years = db.select().from(financeFiscalYears).orderBy(financeFiscalYears.endsOn).all();
  for (const year of years) {
    // Prüferzugang offen nach abgelegtem Bericht: bis zur MV schließen (Schritt 11).
    if (lastFiledReportInternal(db, year.id)) {
      const open = auditorsOfYearInternal(db, year.id).filter((a) => a.mode === 'kompass' && a.accessEndedAt === null).length;
      if (open > 0) push({ key: `auditorAccess:${year.id}`, kind: 'auditorAccess', dueOn: assemblyOfYearInternal(deps, db, year.id, timeZoneOf(deps))?.assemblyOn ?? null, params: { designation: year.designation, count: open }, href: `/finance/audit?year=${year.id}` });
    }
  }

  // Umsatzsteuer (E6a) je Kalenderjahr vom ersten Geschäftsjahr bis heute: Voranmeldung je Zeitraum mit Pflicht, die
  // Jahreserklärung, jeweils bis zur Abgabe; die Berichtigung ohne Datum (unverzüglich, § 153 Abs. 1 AO), bis sie
  // abgegeben ist. `vatPeriod` ist der Schlüssel des Zeitraums — lesbar macht ihn die Oberfläche.
  const firstYear = years[0] ? Number(years[0].startsOn.slice(0, 4)) : null;
  for (let y = firstYear ?? Number(today.slice(0, 4)) + 1; y <= Number(today.slice(0, 4)); y++) {
    const { advance, annual } = vatPeriodViewsInternal(db, y, today, timeZoneOf(deps));
    for (const p of advance) {
      if (p.required && p.filings.length === 0) push({ key: `vatAdvanceReturn:${p.key}`, kind: 'vatAdvanceReturn', dueOn: p.dueOn, params: { vatPeriod: p.key }, href: `/finance/vat?period=${p.key}`, fileableFrom: vatFilingOpensOn(p.key)! });
    }
    const holder = years.find((fy) => fy.startsOn <= annual.endsOn && fy.endsOn >= annual.endsOn);
    if (annual.required && annual.filings.length === 0) push({ key: `vatReturn:${y}`, kind: 'vatReturn', dueOn: annual.dueOn, params: { year: String(y) }, href: holder ? `/finance/reports/vatSummary?year=${holder.id}` : '/finance/reports', fileableFrom: vatFilingOpensOn(String(y))! });
    for (const p of [...advance, annual]) {
      if (!p.amendmentDue) continue;
      // Die Ursache (Board 5a, Unterzeile): Buchung, Art der Änderung, Tag; ohne Abbild der Abgabe keine.
      const cause = p.amendmentCause;
      const causeParams = cause ? { ...(cause.entryNumber ? { entryNumber: cause.entryNumber } : {}), change: cause.change, changedOn: cause.changedOn, more: cause.more } : {};
      push({ key: `vatAmendment:${p.key}`, kind: 'vatAmendment', dueOn: null, params: { vatPeriod: p.key, scope: p.kind === 'year' ? 'year' : 'advance', ...causeParams }, href: p.kind === 'year' ? (holder ? `/finance/reports/vatSummary?year=${holder.id}` : '/finance/reports') : `/finance/vat?period=${p.key}` });
    }
  }

  // Rechenschaft D2: die Abgabefrist je offenem Erklärungszeitraum; sie verschwindet mit „abgegeben am“.
  for (const period of taxPeriodsInternal(db)) {
    if (period.filedOn === null) push({ key: `taxReturn:${period.id}`, kind: 'taxReturn', dueOn: period.dueOn, params: { period: period.label }, href: `/finance/tax?period=${period.id}` });
  }

  for (const d of timelyUseDeadlinesInternal(db, years, today)) push(d);

  return out.sort(deadlineOrder);
}

/**
 * M2 (Spec 0.4.5 Teil M, Entscheidung 4, Prüfung F-4): je Verwendungsrückstand aus einem Jahr über der Grenze eine Frist
 * bis zum Ende des übernächsten Jahres; sie verschwindet mit dem Verbrauch, ohne Häkchen. Ein noch offenes Jahr nicht
 * über der Grenze streicht nichts — erst sein Abschluss; danach steht der Rückstand einmal als Vermerk „entfallen“ da,
 * bis ein späteres Jahr abgeschlossen ist. Unter der Grenze entsteht keine Frist (`originRequired`).
 */
function timelyUseDeadlinesInternal(db: DbOrTx, years: readonly FinanceFiscalYearRow[], today: string): Omit<DeadlineView, 'overdue'>[] {
  if (years.length === 0) return [];
  const closed = new Set(years.filter((y) => fiscalYearStatusInternal(db, y.id) === 'closed').map((y) => y.id));
  const current = years.find((y) => y.startsOn <= today && y.endsOn >= today) ?? years.at(-1)!;
  const lastClosed = [...years].reverse().find((y) => closed.has(y.id)) ?? null;
  const until = lastClosed && lastClosed.endsOn > current.endsOn ? lastClosed : current;
  const chain = fundsUseChainInternal(db, until.id, { lapses: (id) => closed.has(id) });
  const resultOf = (id: string) => chain.find((r) => r.fiscalYearId === id);
  const backlogs = (id: string) => (resultOf(id)?.buckets ?? []).filter((b) => b.originKey !== `fy:${id}` && b.originRequired && b.restCents > 0);
  const out: Omit<DeadlineView, 'overdue'>[] = [];
  if (!resultOf(current.id)?.lapsedAtEnd) {
    for (const b of backlogs(current.id)) out.push({ key: `timelyUse:${b.originKey}`, kind: 'timelyUse', dueOn: b.dueBy, params: { origin: b.originDesignation, restCents: b.restCents }, href: `/finance/fund-use?year=${current.id}` });
  }
  if (lastClosed && resultOf(lastClosed.id)?.lapsedAtEnd) {
    for (const b of backlogs(lastClosed.id)) out.push({ key: `timelyUseLapsed:${b.originKey}`, kind: 'timelyUseLapsed', dueOn: null, params: { origin: b.originDesignation, lapsedIn: lastClosed.designation }, href: `/finance/fund-use?year=${lastClosed.id}` });
  }
  return out;
}

/**
 * Reihenfolge der Fristen (295): die Berichtigung einer Umsatzsteuer-Anmeldung (unverzüglich) ganz oben (Board
 * Umsatzsteuer 5a), dann überfällige, dann nach Tag, „ohne Datum“ zuletzt — auf Bildschirm und über MCP.
 */
export function deadlineOrder(a: { dueOn: string | null; overdue: boolean; kind?: string }, b: { dueOn: string | null; overdue: boolean; kind?: string }): number {
  const urgent = (d: { kind?: string }) => d.kind === 'vatAmendment';
  if (urgent(a) !== urgent(b)) return urgent(a) ? -1 : 1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.dueOn === null || b.dueOn === null) return a.dueOn === b.dueOn ? 0 : a.dueOn === null ? 1 : -1;
  return a.dueOn.localeCompare(b.dueOn);
}

function followUpsInternal(deps: Deps, ctx: CallContext, today: string): FinanceFollowUpView[] {
  const since = `${addDaysInternal(today, -30)}T00:00:00.000Z`;
  return deps.db
    .select()
    .from(schema.followUps)
    .where(inArray(schema.followUps.entityType, [...FINANCE_FOLLOW_UP_ENTITIES]))
    .all()
    .filter((r) => r.doneAt === null || r.doneAt >= since)
    .sort((a, b) => Number(a.doneAt !== null) - Number(b.doneAt !== null) || a.dueAt.localeCompare(b.dueAt))
    .map((r) => {
      const hidden = resolveRecordLabel(deps, ctx, r.entityType, r.entityId)?.state === 'forbidden';
      return { id: r.id, entityType: r.entityType, entityId: r.entityId, dueAt: r.dueAt, title: hidden ? '' : r.title, titleHidden: hidden, doneAt: r.doneAt };
    });
}

/** Das jüngste beendete, offene Jahr ohne offene Wiedervorlage daran — Vorschlag „Jahresabschluss vor der MV“. */
function suggestionsInternal(db: DbOrTx, today: string): FinanceDeadlines['suggestions'] {
  const year = db.select().from(financeFiscalYears).where(lte(financeFiscalYears.endsOn, addDaysInternal(today, -1))).orderBy(desc(financeFiscalYears.endsOn)).all().find((y) => fiscalYearStatusInternal(db, y.id) === 'open');
  if (!year) return [];
  const planned = db.select({ id: schema.followUps.id }).from(schema.followUps).where(and(eq(schema.followUps.entityType, 'financeFiscalYear'), eq(schema.followUps.entityId, year.id), isNull(schema.followUps.doneAt))).get();
  return planned ? [] : [{ key: 'closeBeforeAssembly', fiscalYearId: year.id, designation: year.designation }];
}

/** `finance.overview`: berechnete Fristen, Wiedervorlagen (nur mit `followUps.view`) und Vorschläge. Namen nur mit `finance.read`. */
export async function listFinanceDeadlines(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinanceDeadlines>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  const today = todayIn(deps);
  return ok({
    computed: computedDeadlinesInternal(deps, today, hasPermission(ctx, 'finance.read')),
    followUps: hasPermission(ctx, 'followUps.view') ? followUpsInternal(deps, ctx, today) : null,
    suggestions: suggestionsInternal(deps.db, today),
  });
}
