import type { DbOrTx } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { projects } from '@kompass/module-projects';
import { inArray } from 'drizzle-orm';
import { contactTaxDetailsInternal } from '../allocation/contact-tax-details';
import { nameConsentValidInternal } from '../allocation/name-consents';
import type { AnnualAccounts } from './reports/annual-accounts';

/**
 * Wer in der Jahresrechnung mit Namen erscheint — außerhalb des Hashs (Plan J1, Entscheidung 3): Ein Widerruf oder ein
 * zurückgezogenes Projekt ändert den Datenstand einer festgeschriebenen Fassung nie, nur ein neues Rendern nennt anders.
 * Zuwender (F8): Name gdw. Organisation mit „juristische Person: ja“ oder am Tag `at` geltende Einwilligung für das
 * Jahr, und nicht in `anonymize` (Webfassung nach Widerruf, J2); sonst `null`. Projekte (F3, F6): Name in der
 * Leitsprache gdw. veröffentlicht, sonst `null`.
 */
export function annualAccountsNamingInternal(db: DbOrTx, data: AnnualAccounts, at: string, anonymize: readonly string[] = [], leadingLocale = 'de'): { donors: Record<string, string | null>; projects: Record<string, string | null> } {
  const year = Number(data.year.endsOn.slice(0, 4));
  const donorIds = data.majorDonors.flatMap((d) => (d.contactId ? [d.contactId] : []));
  const rows = donorIds.length > 0 ? db.select().from(contacts).where(inArray(contacts.id, donorIds)).all() : [];
  const donors: Record<string, string | null> = Object.fromEntries(donorIds.map((id) => [id, null]));
  for (const c of rows) {
    if (anonymize.includes(c.id)) continue;
    const legalEntity = c.kind === 'organization' && contactTaxDetailsInternal(db, c.id)?.legalEntity === 'yes';
    if (legalEntity || nameConsentValidInternal(db, c.id, year, at)) donors[c.id] = displayName(c);
  }
  const projectIds = [...new Set([...data.expense.program.projects.flatMap((p) => (p.projectId ? [p.projectId] : [])), ...data.projects.map((p) => p.projectId)])];
  const projectRows = projectIds.length > 0 ? db.select({ id: projects.id, name: projects.name, isPublished: projects.isPublished }).from(projects).where(inArray(projects.id, projectIds)).all() : [];
  const named: Record<string, string | null> = Object.fromEntries(projectIds.map((id) => [id, null]));
  for (const p of projectRows) if (p.isPublished) named[p.id] = (p.name as Record<string, string> | null)?.[leadingLocale]?.trim() || null;
  return { donors, projects: named };
}
