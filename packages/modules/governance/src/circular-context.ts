import { notFound, ok, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { circularIdSchema, circularViewInternal, type CircularView } from './circulars';
import { contactNameInternal } from './minutes/compose';
import { resolveRule, type ResolvedRule } from './rules/resolve';
import type { OrganRules } from './rules/schema';
import { governanceCirculars, governanceOffices, governanceOrgans, governanceResolutions, governanceTerms, type OrganKind } from './schema';
import { statuteRulesOnInternal } from './statutes';
import { termRunsOn } from './term-schedule';

export interface CircularContext {
  circular: CircularView;
  organ: { id: string; kind: OrganKind; name: string };
  /** Kontakt-ID → Name der Antwortenden und der feststellenden Person. */
  names: Record<string, string>;
  /** Kontakt-ID → Amt im Organ am Anfragetag. */
  offices: Record<string, string>;
  /** Regel des Umlaufs am Anfragetag (Rückfall § 32 Abs. 3 BGB). */
  rule: ResolvedRule<OrganRules['circular']>;
  resolution: { id: string; number: string | null } | null;
  /** Nachweise der Antworten. */
  documents: Record<string, { number: string | null; subject: string }>;
}

/** Ein Umlauf mit Namen, Ämtern, Regel und Beschluss (Plan U2) — berechnet, nie gespeichert. */
export async function getCircularContext(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<CircularContext>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, circularIdSchema, input);
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const row = db.select().from(governanceCirculars).where(eq(governanceCirculars.id, parsed.value.id)).get();
  if (!row) return notFound('governanceCircular', parsed.value.id);
  const circular = circularViewInternal(db, row);
  const organ = db.select().from(governanceOrgans).where(eq(governanceOrgans.id, row.organId)).get()!;
  const names: Record<string, string> = {};
  for (const id of [...circular.responses.map((r) => r.contactId), row.decidedByContactId]) if (id) names[id] = contactNameInternal(db, id) ?? '';
  const offices: Record<string, string> = {};
  const organOffices = db.select().from(governanceOffices).where(eq(governanceOffices.organId, organ.id)).all();
  const terms = organOffices.length ? db.select().from(governanceTerms).where(inArray(governanceTerms.officeId, organOffices.map((o) => o.id))).all() : [];
  for (const o of organOffices) for (const t of terms) if (t.officeId === o.id && termRunsOn(t, o, row.requestedOn) && !offices[t.contactId]) offices[t.contactId] = o.name;
  const resolution = db.select({ id: governanceResolutions.id, number: governanceResolutions.number }).from(governanceResolutions).where(eq(governanceResolutions.circularId, row.id)).get() ?? null;
  const docIds = circular.responses.map((r) => r.documentId).filter((x): x is string => x !== null);
  const docs: CircularContext['documents'] = {};
  if (docIds.length) for (const d of db.select({ id: documents.id, number: documents.number, subject: documents.subject }).from(documents).where(inArray(documents.id, docIds)).all()) docs[d.id] = { number: d.number, subject: d.subject };
  return ok({ circular, organ: { id: organ.id, kind: organ.kind, name: organ.name }, names, offices, rule: resolveRule(statuteRulesOnInternal(db, row.requestedOn).rules, organ.id, 'circular'), resolution, documents: docs });
}
