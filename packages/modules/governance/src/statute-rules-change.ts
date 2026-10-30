import { notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { evaluationOfInternal } from './resolutions';
import { majoritySchema, rulesSchema, type Majority, type StatuteRules } from './rules/schema';
import { governanceResolutions, governanceStatutes, type StatuteRow } from './schema';
import { statuteValidOnInternal, statuteViewInternal } from './statutes';

/** Wie Kompass einen festgeschriebenen Beschluss bewertet: nötige Mehrheit und ob sie erreicht ist. */
export interface RulesJudgement {
  required: Majority;
  reached: boolean | null;
}
export interface RulesChangeAffected {
  resolutionId: string;
  number: string;
  kind: string;
  decidedOn: string;
  before: RulesJudgement;
  after: RulesJudgement;
}
export interface RulesChangePreview {
  statuteId: string;
  /** Eingetragener oder abgelöster Stand: Eine Änderung des Regelwerks braucht einen Grund (G-5). */
  reasonRequired: boolean;
  affected: RulesChangeAffected[];
}

export const statuteRulesChangePreviewSchema = z.object({ id: z.string().min(1), rules: rulesSchema });

/** Eingetragen oder abgelöst — dann haben Beschlüsse unter diesem Regelwerk Wirkung entfaltet (G-5). */
export function rulesLockedInternal(db: DbOrTx, deps: Deps, row: StatuteRow): boolean {
  if (row.registeredOn !== null) return true;
  return statuteViewInternal(db, deps, row, todayIn(deps)).state === 'superseded';
}

/**
 * Die festgeschriebenen Beschlüsse (mit Nummer, aus einer Sitzung), für die `row` am Beschlusstag galt und die unter
 * `next` anders bewertet würden — andere nötige Mehrheit oder anderes Ergebnis. Die Bewertung bleibt berechnet
 * (Prinzip 5); diese Liste zeigt nur, was eine Änderung verschöbe.
 */
export function rulesChangeAffectedInternal(db: DbOrTx, deps: Deps, row: StatuteRow, next: StatuteRules): RulesChangeAffected[] {
  const sealed = db.select().from(governanceResolutions).where(isNotNull(governanceResolutions.number)).all();
  const out: RulesChangeAffected[] = [];
  for (const r of sealed) {
    if (!r.meetingId || r.kind === 'election') continue;
    if (statuteValidOnInternal(db, r.decidedOn, { resolvedBefore: true })?.id !== row.id) continue;
    const before = evaluationOfInternal(db, deps, r, row.rules);
    const after = evaluationOfInternal(db, deps, r, next);
    if (!before || !after) continue;
    // Gespeicherte Regeln vor 0.5.0 ohne `comparison` meinen „mindestens“ — gleich gelesen, nicht als Änderung gezählt.
    const judged = (e: NonNullable<typeof before>): RulesJudgement => ({ required: majoritySchema.parse(e.required.value), reached: e.result.reached });
    const b = judged(before);
    const a = judged(after);
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ resolutionId: r.id, number: r.number!, kind: r.kind, decidedOn: r.decidedOn, before: b, after: a });
  }
  return out.sort((x, y) => x.number.localeCompare(y.number));
}

/** Vorschau vor `governance_statute_update` mit `rules`: braucht es einen Grund, welche Beschlüsse würden anders bewertet. */
export async function previewStatuteRulesChange(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RulesChangePreview>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, statuteRulesChangePreviewSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(governanceStatutes).where(eq(governanceStatutes.id, parsed.value.id)).get();
  if (!row) return notFound('governanceStatute', parsed.value.id);
  const reasonRequired = rulesLockedInternal(deps.db, deps, row);
  return ok({ statuteId: row.id, reasonRequired, affected: rulesChangeAffectedInternal(deps.db, deps, row, parsed.value.rules) });
}
