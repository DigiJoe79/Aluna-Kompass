import { isModuleEnabled, type DbOrTx, type Deps } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import type { AuditorCandidate, FinanceFiscalYearRow } from '@kompass/module-finance';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { minutesVersionsInternal } from '../minutes/signed';
import { governanceLabelText } from './labels';
import { governanceMeetings, governanceOffices, governanceResolutions, governanceTerms } from '../schema';

/**
 * Quelle für den Prüfer-Dialog der Finanzen (Spec § 8.1, G7): die Inhaberschaften eines Amts mit `function: 'auditor'`,
 * die das Geschäftsjahr überlappen. „Gewählt am“ ist der Tag der Sitzung des Wahlbeschlusses, ohne Sitzung (Umlauf) der
 * Tag der Annahme, ohne Beschluss (nachgetragen) leer; das Protokoll ist das der Sitzung. Ohne Gremien leer.
 */
export function auditorCandidatesInternal(deps: Deps, db: DbOrTx, year: FinanceFiscalYearRow): AuditorCandidate[] {
  if (!isModuleEnabled(deps, 'governance')) return [];
  const offices = db.select({ id: governanceOffices.id }).from(governanceOffices).where(eq(governanceOffices.function, 'auditor')).all().map((o) => o.id);
  if (offices.length === 0) return [];
  const terms = db
    .select()
    .from(governanceTerms)
    .where(and(inArray(governanceTerms.officeId, offices), lte(governanceTerms.since, year.endsOn), or(isNull(governanceTerms.until), gte(governanceTerms.until, year.startsOn))))
    .orderBy(governanceTerms.since, governanceTerms.id)
    .all();
  const seen = new Set<string>();
  const out: AuditorCandidate[] = [];
  for (const term of terms) {
    if (seen.has(term.contactId)) continue;
    seen.add(term.contactId);
    const contact = db.select().from(contacts).where(eq(contacts.id, term.contactId)).get();
    if (!contact) continue;
    const resolution = term.resolutionId ? db.select().from(governanceResolutions).where(eq(governanceResolutions.id, term.resolutionId)).get() : undefined;
    const meeting = resolution?.meetingId ? db.select({ id: governanceMeetings.id, heldOn: governanceMeetings.heldOn }).from(governanceMeetings).where(eq(governanceMeetings.id, resolution.meetingId)).get() : undefined;
    out.push({
      contactId: contact.id,
      name: displayName(contact),
      electedOn: meeting?.heldOn ?? (resolution ? term.acceptedOn : null),
      minutesDocumentId: meeting ? (minutesVersionsInternal(db, meeting.id).at(-1)?.documentId ?? null) : null,
      source: resolution
        ? { label: governanceLabelText(deps, 'governanceResolution', resolution.id) ?? resolution.decidedOn, href: `/governance/resolutions/${resolution.id}` }
        : { label: governanceLabelText(deps, 'governanceTerm', term.id) ?? '', href: '/governance/organs' },
    });
  }
  return out;
}
