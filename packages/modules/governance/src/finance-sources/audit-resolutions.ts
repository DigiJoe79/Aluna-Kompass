import { isModuleEnabled, type DbOrTx, type Deps } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { AUDIT_RESOLUTION_KINDS, financeFiscalYears, type AuditResolution, type AuditResolutionKind, type FinanceFiscalYearRow } from '@kompass/module-finance';
import { memberFeeSchedules } from '@kompass/module-members';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { minutesVersionsInternal } from '../minutes/signed';
import { governanceCirculars, governanceMeetings, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type ResolutionRow } from '../schema';

/** Arten mit Geschäftsjahr; die übrigen gelten ab einem Tag bis zur nächsten Regel derselben Art. */
const YEAR_BOUND: readonly AuditResolutionKind[] = ['discharge', 'accounts', 'reserve'];

type Sealed = { row: ResolutionRow & { kind: AuditResolutionKind; outcome: 'adopted' | 'rejected'; number: string }; organ: string; viaCircular: boolean; meetingId: string | null };
type Details = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Quelle für Abschnitt 9 der Kassenprüfung (G-30, Joe 2026-10-29, Option c): die **festgeschriebenen**, angenommenen
 * oder abgelehnten Beschlüsse der sechs finanzwirksamen Arten, die im Prüfjahr gefasst wurden **oder** in ihm wirken —
 * Entlastung, Kassenbericht und Rücklage über ihr Geschäftsjahr; Vergütung, Aufwendungsersatz und Beitragsordnung ab
 * „gilt ab“ bis zur nächsten angenommenen Regel derselben Art (mindestens ein Tag im Jahr). Angaben ohne Freitext.
 * Ohne Gremien `null` — dann gibt es den Abschnitt nicht. Schreibt nichts.
 */
export function auditResolutionsInternal(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): AuditResolution[] | null {
  if (!isModuleEnabled(deps, 'governance')) return null;
  const organs = new Map(db.select({ id: governanceOrgans.id, name: governanceOrgans.name }).from(governanceOrgans).all().map((o) => [o.id, o.name]));
  const sealedMeetings = new Set(db.select({ id: governanceMeetings.id, sealedAt: governanceMeetings.sealedAt }).from(governanceMeetings).all().filter((m) => m.sealedAt !== null).map((m) => m.id));
  const sealedCirculars = new Set(db.select({ id: governanceCirculars.id, sealedAt: governanceCirculars.sealedAt }).from(governanceCirculars).all().filter((c) => c.sealedAt !== null).map((c) => c.id));
  const sealed: Sealed[] = db
    .select()
    .from(governanceResolutions)
    .where(inArray(governanceResolutions.kind, [...AUDIT_RESOLUTION_KINDS]))
    .all()
    .filter((r): r is Sealed['row'] => (r.outcome === 'adopted' || r.outcome === 'rejected') && r.number !== null)
    .filter((r) => (r.meetingId !== null && sealedMeetings.has(r.meetingId)) || (r.circularId !== null && sealedCirculars.has(r.circularId)))
    .map((row) => ({ row, organ: organs.get(row.organId) ?? '', viaCircular: row.circularId !== null && row.meetingId === null, meetingId: row.meetingId }));

  const validFromOf = (s: Sealed): string | undefined => {
    const d = (s.row.details ?? {}) as Details;
    if (s.row.kind !== 'feeSchedule') return str(d.validFrom);
    const scheduleId = str(d.feeScheduleId);
    const schedule = scheduleId
      ? db.select({ validFrom: memberFeeSchedules.validFrom }).from(memberFeeSchedules).where(eq(memberFeeSchedules.id, scheduleId)).get()
      : db.select({ validFrom: memberFeeSchedules.validFrom }).from(memberFeeSchedules).where(eq(memberFeeSchedules.resolutionId, s.row.id)).get();
    return schedule?.validFrom;
  };

  const inYear = (day: string) => day >= year.startsOn && day <= year.endsOn;
  const effective = (s: Sealed): boolean => {
    const d = (s.row.details ?? {}) as Details;
    if (YEAR_BOUND.includes(s.row.kind)) return d.fiscalYearId === year.id;
    if (s.row.outcome !== 'adopted') return false;
    const from = validFromOf(s);
    if (!from || from > year.endsOn) return false;
    // Die nächste angenommene Regel derselben Art beendet diese am Vortag ihres „gilt ab“.
    const next = sealed
      .filter((o) => o.row.kind === s.row.kind && o.row.outcome === 'adopted' && o.row.id !== s.row.id)
      .map(validFromOf)
      .filter((v): v is string => !!v && v > from)
      .sort()[0];
    return next === undefined || next > year.startsOn;
  };

  const designations = new Map(db.select({ id: financeFiscalYears.id, designation: financeFiscalYears.designation }).from(financeFiscalYears).all().map((y) => [y.id, y.designation]));
  const offices = new Map(db.select().from(governanceOffices).all().map((o) => [o.id, o]));
  const officeOn = (contactId: string, day: string): string | undefined => {
    const term = db
      .select({ officeId: governanceTerms.officeId })
      .from(governanceTerms)
      .where(and(eq(governanceTerms.contactId, contactId), lte(governanceTerms.since, day), or(isNull(governanceTerms.until), gte(governanceTerms.until, day))))
      .orderBy(governanceTerms.since)
      .get();
    return term ? offices.get(term.officeId)?.name : undefined;
  };

  const factsOf = (s: Sealed): AuditResolution['facts'] => {
    const d = (s.row.details ?? {}) as Details;
    const facts: AuditResolution['facts'] = {};
    if (typeof d.amountCents === 'number') facts.amountCents = d.amountCents;
    const fiscalYear = str(d.fiscalYearId) ? designations.get(d.fiscalYearId as string) : undefined;
    switch (s.row.kind) {
      case 'discharge': {
        if (fiscalYear) facts.fiscalYear = fiscalYear;
        if (d.mode === 'collective') facts.collective = true;
        else {
          // Das Amt am Ende des Geschäftsjahrs, sonst am Beschlusstag.
          const end = str(d.fiscalYearId) ? db.select({ endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).where(eq(financeFiscalYears.id, d.fiscalYearId as string)).get()?.endsOn : undefined;
          const persons = (Array.isArray(d.contactIds) ? (d.contactIds as string[]) : []).flatMap((id) => {
            const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
            if (!contact) return [];
            const office = officeOn(id, end ?? s.row.decidedOn) ?? officeOn(id, s.row.decidedOn);
            return [office ? `${displayName(contact)} (${office})` : displayName(contact)];
          });
          if (persons.length > 0) facts.persons = persons.join(', ');
        }
        break;
      }
      case 'accounts':
        if (fiscalYear) facts.fiscalYear = fiscalYear;
        break;
      case 'remuneration': {
        if (d.mode === 'flat' || d.mode === 'activity') facts.remunerationMode = d.mode;
        const names = [...new Set((Array.isArray(d.officeIds) ? (d.officeIds as string[]) : []).map((id) => organs.get(offices.get(id)?.organId ?? '')).filter((n): n is string => !!n))];
        if (names.length > 0) facts.organs = names.join(', ');
        if (str(d.validFrom)) facts.validFrom = d.validFrom as string;
        break;
      }
      case 'expenseRule':
        if (d.basis === 'statute' || d.basis === 'contract' || d.basis === 'boardResolution') facts.expenseBasis = d.basis;
        if (str(d.validFrom)) facts.validFrom = d.validFrom as string;
        break;
      case 'reserve':
        if (d.type === 'nr1' || d.type === 'nr2' || d.type === 'nr3' || d.type === 'nr4') facts.reserveType = d.type;
        if (d.action === 'create' || d.action === 'withdraw' || d.action === 'dissolve') facts.reserveAction = d.action;
        if (fiscalYear) facts.fiscalYear = fiscalYear;
        break;
      case 'feeSchedule': {
        const from = validFromOf(s);
        if (from) facts.validFrom = from;
        break;
      }
    }
    return facts;
  };

  return sealed
    .filter((s) => inYear(s.row.decidedOn) || effective(s))
    .sort((a, b) => a.row.decidedOn.localeCompare(b.row.decidedOn) || a.row.number.localeCompare(b.row.number))
    .map((s) => ({
      id: s.row.id,
      number: s.row.number,
      decidedOn: s.row.decidedOn,
      kind: s.row.kind,
      outcome: s.row.outcome,
      organ: s.organ,
      viaCircular: s.viaCircular,
      minutesDocumentId: s.meetingId ? (minutesVersionsInternal(db, s.meetingId).at(-1)?.documentId ?? null) : null,
      facts: factsOf(s),
    }));
}
