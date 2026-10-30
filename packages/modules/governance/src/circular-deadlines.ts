import type { DbOrTx } from '@kompass/core';
import { governanceCirculars } from './schema';

/** Eine Frist eines offenen Umlaufs (Plan U2): Antworten bis zum Fristtag, danach überfällig. */
export interface CircularDeadline {
  key: string;
  kind: 'circularDue';
  dueOn: string;
  overdue: boolean;
  params: { requestedOn: string };
  href: string;
}

/** Je Umlauf ohne Feststellung und nicht festgeschrieben die Frist der Antworten (Spec § 5.6, § 11). */
export function circularDeadlinesInternal(db: DbOrTx, today: string): CircularDeadline[] {
  return db
    .select()
    .from(governanceCirculars)
    .all()
    .filter((c) => c.sealedAt === null && c.outcome === null)
    .map((c) => ({ key: `circularDue:${c.id}`, kind: 'circularDue', dueOn: c.deadline, overdue: today > c.deadline, params: { requestedOn: c.requestedOn }, href: `/governance/circulars/${c.id}` }));
}
