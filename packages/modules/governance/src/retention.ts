import type { Deps, RetentionHoldInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { governanceOffices, governanceTerms } from './schema';

const endOfYearAfter = (isoDay: string, years: number) => `${Number(isoDay.slice(0, 4)) + years}-12-31`;

/**
 * Halter (Spec Gremien § 9.3): Jede Amtsinhaberschaft hält ihren Kontakt, solange sie läuft, und danach bis zum Ende
 * des zehnten Kalenderjahres nach dem Amtsende — Haftung und Entlastung, Klasse wie Finanzdaten. Anwesende und
 * Kandidaten halten nicht (ab G3).
 */
export function governanceRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHoldInput[] {
  if (entityType !== 'contact') return [];
  return deps.db
    .select({ id: governanceTerms.id, until: governanceTerms.until, office: governanceOffices.name })
    .from(governanceTerms)
    .innerJoin(governanceOffices, eq(governanceTerms.officeId, governanceOffices.id))
    .where(eq(governanceTerms.contactId, id))
    .all()
    .map((term) => ({ label: { key: 'governance.retention.termLabel', params: { office: term.office } }, until: term.until === null ? null : endOfYearAfter(term.until, 10), entity: 'governanceTerm', id: term.id }));
}
