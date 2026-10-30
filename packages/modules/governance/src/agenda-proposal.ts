import { isoNow, newId, notFound, ok, readLocales, recordAudit, requirePermission, timeZoneOf, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { assemblyOfYearInternal, financeFiscalYears, fiscalYearStatusInternal, lastFiledReportInternal, scansOfInternal } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { agendaProposeSchema, agendaViewsInternal, cashReportDocumentInternal, type AgendaItemView } from './agenda';
import { governanceConflict } from './errors';
import { meetingRowInternal, refuseUnlessPreparing } from './meetings';
import { governanceAgendaItems, governanceOrgans, type AgendaItemRow, type MeetingRow } from './schema';
import { START_AGENDA, startName } from './start-data';
import { officesDueInternal } from './term-schedule';

/** Was für ein Geschäftsjahr schon entschieden ist (Schritt 11 der Finanzen, geführt oder von Hand; W-2). */
function settledOf(deps: Deps, db: DbOrTx, fiscalYearId: string): { accounts: boolean; discharge: boolean } {
  const result = assemblyOfYearInternal(deps, db, fiscalYearId, timeZoneOf(deps));
  return { accounts: result?.accountsApproved === 'yes', discharge: result?.complete === true };
}

/**
 * Das jüngste abgeschlossene Geschäftsjahr, das vor dem Sitzungstag endet und noch nicht genehmigt und vollständig
 * entlastet ist (W-2) — samt dem, was davon schon entschieden ist. Ohne abgeschlossenes Jahr `null`.
 */
function lastClosedYear(deps: Deps, db: DbOrTx, heldOn: string): { id: string | null; accounts: boolean; discharge: boolean } | null {
  const years = db.select().from(financeFiscalYears).all().filter((y) => y.endsOn < heldOn && fiscalYearStatusInternal(db, y.id) === 'closed');
  if (years.length === 0) return null;
  const open = years.sort((a, b) => b.endsOn.localeCompare(a.endsOn)).map((y) => ({ id: y.id, ...settledOf(deps, db, y.id) })).find((y) => !y.accounts || !y.discharge);
  return open ?? { id: null, accounts: true, discharge: true };
}

/** Ämter, die die Mitgliederversammlung wählt (ihre eigenen und die des Vorstands) und die am Sitzungstag fällig sind. */
function officesToElect(db: DbOrTx, heldOn: string): string[] {
  const organs = new Map(db.select().from(governanceOrgans).all().map((o) => [o.id, o.kind]));
  return [...new Set(officesDueInternal(db, heldOn).filter((d) => organs.get(d.organId) !== 'other').map((d) => d.officeId))];
}

/** Die Punkte des Vorschlags (Spec § 5.2), noch ohne Zeilen. */
function proposalFor(db: DbOrTx, deps: Deps, meeting: MeetingRow): Omit<AgendaItemRow, 'id' | 'meetingId' | 'createdAt' | 'updatedAt'>[] {
  const locale = readLocales(deps)[0] ?? 'de';
  const year = meeting.kind === 'ordinary' ? lastClosedYear(deps, db, meeting.heldOn) : null;
  const fiscalYearId = year?.id ?? null;
  // W-2: Kassenbericht nicht für ein genehmigtes Jahr, Prüfbericht und Entlastung nicht für ein vollständig entlastetes.
  const settled = (role: string | undefined, kind: string): boolean => (kind === 'accounts' || role === 'cashReport' ? !!year?.accounts : kind === 'discharge' || role === 'auditReport' ? !!year?.discharge : false);
  const elect = officesToElect(db, meeting.heldOn);
  const auditScans = () => {
    const report = fiscalYearId ? lastFiledReportInternal(db, fiscalYearId) : null;
    return report ? scansOfInternal(db, report.id).map((s) => s.documentId) : [];
  };
  const cash = () => (fiscalYearId ? cashReportDocumentInternal(db, fiscalYearId) : null);
  return START_AGENDA[meeting.kind]
    .filter((item) => item.role !== 'election' || elect.length > 0)
    .filter((item) => !settled(item.role, item.kind))
    .map((item, index) => ({
      position: index + 1,
      kind: item.kind,
      title: startName(item.title, locale),
      invitationText: null,
      proposal: null,
      attachmentDocumentIds: item.role === 'cashReport' ? [cash()].filter((d): d is string => d !== null) : item.role === 'auditReport' ? auditScans() : [],
      officeIds: item.role === 'election' ? elect : [],
      fiscalYearId: item.kind === 'accounts' || item.kind === 'discharge' ? fiscalYearId : null,
      statuteId: null,
      motionId: null,
      minutesNote: null,
      wordingChanges: [],
      addedDuring: 'preparation' as const,
    }));
}

/** Legt den Vorschlag der Tagesordnung je Art an — nur auf einer leeren Tagesordnung. */
export async function proposeAgenda(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AgendaItemView[]>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, agendaProposeSchema, input);
  if (!parsed.ok) return parsed;
  const meeting = meetingRowInternal(deps.db, parsed.value.meetingId);
  if (!meeting) return notFound('governanceMeeting', parsed.value.meetingId);
  const refused = refuseUnlessPreparing(meeting);
  if (refused) return refused;
  if (deps.db.select({ id: governanceAgendaItems.id }).from(governanceAgendaItems).where(eq(governanceAgendaItems.meetingId, meeting.id)).get()) return governanceConflict('agendaNotEmpty');
  const items = proposalFor(deps.db, deps, meeting);
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    for (const item of items) tx.insert(governanceAgendaItems).values({ id: newId(), meetingId: meeting.id, ...item, createdAt: now, updatedAt: now }).run();
    recordAudit(tx, deps, ctx, { action: 'governance.agenda.propose', entityType: 'governanceMeeting', entityId: meeting.id, after: { kinds: items.map((i) => i.kind) }, params: { count: items.length } });
    return ok(agendaViewsInternal(deps, tx, meeting));
  });
}
