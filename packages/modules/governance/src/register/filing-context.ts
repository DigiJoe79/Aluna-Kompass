import { notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { contactNameInternal } from '../minutes/compose';
import { resolveRule, type ResolvedRule } from '../rules/resolve';
import type { OrganRules } from '../rules/schema';
import { governanceMeetings, governanceOffices, governanceOrgans, governanceTerms, type MeetingKind, type OccasionRow } from '../schema';
import { statuteRulesOnInternal } from '../statutes';
import { addCalendarDays } from '@kompass/module-finance';
import { filingRowInternal, filingViewInternal, type FilingView } from './filings';
import { filingRequirementsInternal, type RequirementRow } from './requirements';

export type FilingContextOccasion = OccasionRow & { meetingKind: MeetingKind | null; heldOn: string | null; officeName: string | null; before: string | null; after: string | null };
export interface FilingContext {
  filing: FilingView;
  requirements: RequirementRow[];
  occasions: FilingContextOccasion[];
  notary: { contactId: string; name: string } | null;
  documents: Record<string, { number: string | null; subject: string; documentDate: string | null }>;
  /** Aus dem Vereinsstamm; ohne Nummer `null`. */
  register: { court: string; number: string } | null;
  /** `governance.registerOverdueDays` — für den Grund von Frage 1. */
  overdueDays: number;
  /** Vertretung des Vorstands heute. */
  representation: ResolvedRule<OrganRules['representation']> | null;
}

export const filingContextSchema = z.object({ filingId: z.string().min(1) });

/** Eine Registeranmeldung mit allem, was die Seite zeigt (Plan U2) — berechnet, nie gespeichert. */
export async function getFilingContext(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingContext>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, filingContextSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const row = filingRowInternal(db, parsed.value.filingId);
  if (!row) return notFound('governanceRegisterFiling', parsed.value.filingId);
  const today = todayIn(deps);
  const filing = filingViewInternal(db, deps, row, today);
  const requirements = filingRequirementsInternal(db, row, today);
  const terms = db.select().from(governanceTerms).all();
  const offices = new Map(db.select().from(governanceOffices).all().map((o) => [o.id, o]));
  const occasions = filing.occasions.map((o): FilingContextOccasion => {
    const meeting = o.meetingId ? db.select().from(governanceMeetings).where(eq(governanceMeetings.id, o.meetingId)).get() : undefined;
    const term = o.termId ? terms.find((t) => t.id === o.termId) : undefined;
    const officeId = o.officeId ?? term?.officeId ?? null;
    let before: string | null = null;
    let after: string | null = null;
    if (o.kind === 'boardChange' && term) {
      const sameOffice = terms.filter((t) => t.officeId === term.officeId && t.id !== term.id);
      if (term.since >= o.occurredOn || term.since === meeting?.heldOn) {
        after = contactNameInternal(db, term.contactId);
        const pred = sameOffice.find((t) => t.until === addCalendarDays(term.since, -1));
        before = pred ? contactNameInternal(db, pred.contactId) : null;
      } else {
        before = contactNameInternal(db, term.contactId);
        const succ = sameOffice.filter((t) => term.until !== null && t.since > term.until).sort((a, b) => a.since.localeCompare(b.since))[0];
        after = succ ? contactNameInternal(db, succ.contactId) : null;
      }
    }
    return { ...o, meetingKind: meeting?.kind ?? null, heldOn: meeting?.heldOn ?? null, officeName: officeId ? (offices.get(officeId)?.name ?? null) : null, before, after };
  });
  const docIds = [...new Set([...requirements.flatMap((r) => r.documentIds), ...filing.interimOrders.flatMap((i) => (i.documentId ? [i.documentId] : [])), ...(row.extractDocumentId ? [row.extractDocumentId] : []), ...(filing.transparency.confirmationDocumentId ? [filing.transparency.confirmationDocumentId] : [])])];
  const docs: FilingContext['documents'] = {};
  if (docIds.length) for (const d of db.select({ id: documents.id, number: documents.number, subject: documents.subject, documentDate: documents.documentDate }).from(documents).where(inArray(documents.id, docIds)).all()) docs[d.id] = { number: d.number, subject: d.subject, documentDate: d.documentDate };
  const court = readSetting<string>(deps, 'organization.registerCourt');
  const number = readSetting<string>(deps, 'organization.registerNumber');
  const board = db.select().from(governanceOrgans).where(eq(governanceOrgans.kind, 'board')).get();
  return ok({
    filing,
    requirements,
    occasions,
    notary: row.notaryContactId ? { contactId: row.notaryContactId, name: contactNameInternal(db, row.notaryContactId) ?? '' } : null,
    documents: docs,
    register: number ? { court, number } : null,
    overdueDays: readSetting<number>(deps, 'governance.registerOverdueDays'),
    representation: board ? resolveRule(statuteRulesOnInternal(db, today).rules, board.id, 'representation') : null,
  });
}
