import { addCalendarDays } from '@kompass/module-finance';
import { z } from 'zod';
import type { DbOrTx } from '@kompass/core';
import { eq, inArray } from 'drizzle-orm';
import { AGENDA_KINDS } from './agenda-kinds';
import { resolveRule } from './rules/resolve';
import type { ResolutionKind, StatuteRules } from './rules/schema';
import { governanceOffices, governanceOrgans, governanceStatutes, type ResolutionRow } from './schema';

const DAY = z.iso.date();
const id = z.string().min(1);
const cents = z.number().int().min(0).max(1_000_000_000);

/** Vergütung von Ämtern (§ 27 Abs. 3 S. 2, § 40 BGB; § 55 AO). */
export const remunerationDetailsSchema = z.strictObject({
  statuteReference: z.string().trim().min(1).max(200).nullable(),
  decidedByOrganId: id,
  officeIds: z.array(id).min(1).max(20),
  mode: z.enum(['flat', 'activity']),
  amountCents: cents,
  validFrom: DAY,
});
/** Regel für Aufwendungsersatz — vor der Tätigkeit begründet (BMF 25.11.2014). */
export const expenseRuleDetailsSchema = z.strictObject({ basis: z.enum(['statute', 'contract', 'boardResolution']), rule: z.string().trim().min(1).max(2000), validFrom: DAY });
/** Rücklage nach § 62 Abs. 1 Nr. 1–4 AO; Nr. 1 und 2 brauchen einen konkreten Zweck. */
export const reserveDetailsSchema = z
  .strictObject({ type: z.enum(['nr1', 'nr2', 'nr3', 'nr4']), purpose: z.string().trim().min(1).max(500).nullable(), amountCents: cents, fiscalYearId: id, action: z.enum(['create', 'withdraw', 'dissolve']) })
  .refine((d) => !(d.type === 'nr1' || d.type === 'nr2') || d.purpose !== null, { message: 'purposeRequired', path: ['purpose'] });
/** Ausschluss als Prüfliste (BGHZ 87, 337); die Gründe stehen in einem Dokument im Bereich `members`. */
export const exclusionDetailsSchema = z.strictObject({
  membershipId: id,
  statuteGround: z.string().trim().min(1).max(200).nullable(),
  reasonsSentOn: DAY.nullable(),
  hearingOn: DAY.nullable(),
  reasonsDocumentId: id.nullable(),
  noticeReceivedOn: DAY.nullable(),
});
export const dischargeDetailsSchema = z.strictObject({ fiscalYearId: id, mode: z.enum(['individual', 'collective']), contactIds: z.array(id).max(50) });
/** Auftrag an genau ein Organ oder ein Amt; die Wiedervorlage entsteht beim Festschreiben (G4). */
export const mandateDetailsSchema = z
  .strictObject({ organId: id.nullable(), officeId: id.nullable(), dueOn: DAY, task: z.string().trim().min(1).max(2000) })
  .refine((d) => (d.organId === null) !== (d.officeId === null), { message: 'recipientRequired', path: ['organId'] });

/** Ein Wahlgang (Spec § 5.4): Stimmen je Kandidat, dazu Nein, Enthaltung, ungültig; „einstimmig“ nennt die Person. */
export const electionRoundSchema = z.strictObject({
  number: z.number().int().min(1).max(20),
  runoff: z.boolean(),
  candidates: z.array(z.strictObject({ contactId: id, votes: z.number().int().min(0).max(100000) })).max(50),
  no: z.number().int().min(0).max(100000),
  abstain: z.number().int().min(0).max(100000),
  invalid: z.number().int().min(0).max(100000),
  unanimousContactId: id.nullable(),
});
export const electionDetailsSchema = z.strictObject({
  officeId: id,
  rounds: z.array(electionRoundSchema).max(20),
  elected: z.array(z.strictObject({ contactId: id, acceptedOn: DAY.nullable(), declinedOn: DAY.nullable() })).max(50),
});
export type ElectionDetails = z.infer<typeof electionDetailsSchema>;

/** Angaben der strukturierten Beschlussarten (Spec § 4.2); Arten ohne Eintrag tragen keine. */
export const RESOLUTION_DETAILS: Partial<Record<ResolutionKind, z.ZodType>> = {
  remuneration: remunerationDetailsSchema,
  expenseRule: expenseRuleDetailsSchema,
  reserve: reserveDetailsSchema,
  exclusion: exclusionDetailsSchema,
  discharge: dischargeDetailsSchema,
  accounts: z.strictObject({ fiscalYearId: id }),
  statute: z.strictObject({ statuteId: id }),
  purpose: z.strictObject({ statuteId: id }),
  dismissal: z.strictObject({ termId: id }),
  mandate: mandateDetailsSchema,
  honoraryMember: z.strictObject({ membershipId: id, typeId: id }),
  feeSchedule: z.strictObject({ feeScheduleId: id.nullable() }),
  dissolution: z.strictObject({ liquidatorContactIds: z.array(id).max(20) }),
  election: electionDetailsSchema,
  /** Nur die Aufnahme eines späten Antrags (`admitLateMotion`): welcher Antrag, als welche Art. */
  /** `afterItemId`: Antrag aus der Versammlung — der TOP entsteht hinter diesem Punkt (Plan U1, Entscheidung 3). */
  agenda: z.strictObject({ motionId: id, kind: z.enum(AGENDA_KINDS), afterItemId: id.optional() }),
};

type JsonSchema = { type?: string; enum?: unknown[]; format?: string; anyOf?: JsonSchema[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[] };

function typeWords(s: JsonSchema): string {
  if (s.anyOf) return s.anyOf.map(typeWords).join('|');
  if (s.enum) return s.enum.join('|');
  if (s.type === 'array') return `${typeWords(s.items ?? {})}[]`;
  if (s.type === 'string') return s.format === 'date' ? 'YYYY-MM-DD' : 'string';
  return s.type ?? 'value';
}

/**
 * Die Angaben je Beschlussart als Text für das Werkzeugschema (G-20): `details` bleibt `unknown` — geprüft wird je Art
 * im Dienst —, aber ein Agent sieht die Felder. Ohne Wahl und Aufnahme, die eigene Werkzeuge haben.
 */
export const DETAILS_HINT = `Details by kind (checked per kind; optional fields marked ?): ${Object.entries(RESOLUTION_DETAILS)
  .filter(([kind]) => kind !== 'agenda' && kind !== 'election')
  .map(([kind, schema]) => {
    const json = z.toJSONSchema(schema!, { io: 'input' }) as JsonSchema;
    const fields = Object.entries(json.properties ?? {}).map(([name, s]) => `${name}${json.required?.includes(name) ? '' : '?'}: ${typeWords(s)}`);
    return `${kind}: {${fields.join(', ')}}`;
  })
  .join('; ')}.`;

/** `remunerationWrongOrgan`: das beschließende Organ ist nicht das, das die Regel `remuneration.decidedBy` vorsieht (L-1). */
/** `statuteRegistered`, `statuteNotAssembly`: Satzungs- oder Zweckbeschluss an einem eingetragenen Stand bzw. nicht von der MV (L-3, G-4). */
export type DetailWarning = 'statuteRegistered' | 'statuteNotAssembly' | 'remunerationWithoutStatute' | 'remunerationWrongOrgan' | 'expenseRuleRetroactive' | 'exclusionChecklistOpen' | 'detailsMissing';

/**
 * Arten, deren Folge beim Festschreiben an den Angaben hängt — ohne sie wirkt der Beschluss nichts (G-3). Genehmigung
 * der Jahresrechnung und Entlastung brauchen das Geschäftsjahr, sonst erfahren die Finanzen nichts davon (V-5).
 */
export const DETAILS_NEEDED: readonly ResolutionKind[] = ['dismissal', 'statute', 'purpose', 'mandate', 'exclusion', 'honoraryMember', 'accounts', 'discharge'];

/** Die Organe aus `organIds`, denen der Stand `rules` eine Vergütung erlaubt (Regel `remuneration`). */
export function remunerationRuledOrganIds(rules: StatuteRules, organIds: readonly string[]): string[] {
  return organIds.filter((organId) => !!resolveRule(rules, organId, 'remuneration').value);
}

/**
 * W-4: Vergütung ohne Satzungsgrundlage — keins der beteiligten Organe (beschließendes Organ, „beschlossen von“, Organe
 * der vergüteten Ämter) hat im am Tag gültigen Stand die Regel `remuneration` (§ 71 BGB: eine Änderung wirkt erst mit
 * Eintragung). Ein eingetragener Verweis ersetzt sie nicht. Dieselbe Bedingung nutzt der Formularhinweis über
 * `remunerationRuledOrganIds`.
 */
export function remunerationWithoutStatute(rules: StatuteRules, organIds: Iterable<string | null | undefined>): boolean {
  const ids = [...new Set([...organIds].filter((id): id is string => !!id))];
  return remunerationRuledOrganIds(rules, ids).length === 0;
}

/** Je Organ mit der Regel `remuneration` im Stand `rules` das Organ, das über die Vergütung beschließt (`decidedBy`). */
export function remunerationDeciders(rules: StatuteRules, organIds: readonly string[]): Record<string, string> {
  return Object.fromEntries(organIds.flatMap((organId) => {
    const rule = resolveRule(rules, organId, 'remuneration').value;
    return rule ? [[organId, rule.decidedBy]] : [];
  }));
}

/**
 * L-1: Vergütung vom falschen Organ — unter den beteiligten Organen (`organIds`) hat mindestens eines die Regel
 * `remuneration`, aber keine dieser Regeln nennt das beschließende Organ als `decidedBy` (§ 27 Abs. 3 S. 2, § 40 BGB:
 * die Satzung bestimmt, wer beschließt). Ohne Regel greift `remunerationWithoutStatute`. Dieselbe Bedingung nutzt der
 * Formularhinweis über `remunerationDeciders`.
 */
export function remunerationWrongOrgan(deciders: Record<string, string>, decidingOrganId: string, organIds: Iterable<string | null | undefined>): boolean {
  const ruled = [...new Set([...organIds].filter((id): id is string => !!id && id in deciders))];
  return ruled.length > 0 && !ruled.some((id) => deciders[id] === decidingOrganId);
}

/**
 * L-3: Die Prüfungen aus G-4 (`statute_update`) auch für Beschlüsse aus Sitzung und Umlauf — ein Satzungs- oder
 * Zweckbeschluss nennt einen eingetragenen Stand (`statuteRegistered`; nicht, wenn der Beschluss schon am Stand steht
 * oder einen nachgetragenen Eintrag ohne Beschluss am selben Tag füllt) oder stammt nicht von der
 * Mitgliederversammlung (`statuteNotAssembly`, § 33 BGB). Hinweise; angenommen sperren sie das Festschreiben.
 */
export function statuteResolutionWarningsInternal(db: DbOrTx, row: Pick<ResolutionRow, 'kind' | 'details' | 'decidedOn' | 'organId'> & { id?: string | null }): DetailWarning[] {
  if (row.kind !== 'statute' && row.kind !== 'purpose') return [];
  const statuteId = (row.details as { statuteId?: string } | null)?.statuteId;
  if (!statuteId) return [];
  const out: DetailWarning[] = [];
  const statute = db.select().from(governanceStatutes).where(eq(governanceStatutes.id, statuteId)).get();
  const linked = !!statute && statute.resolutions.some((r) => (row.id && r.resolutionId === row.id) || (r.resolutionId === null && r.on === row.decidedOn));
  if (statute && statute.registeredOn !== null && !linked) out.push('statuteRegistered');
  if (db.select().from(governanceOrgans).where(eq(governanceOrgans.id, row.organId)).get()?.kind !== 'assembly') out.push('statuteNotAssembly');
  return out;
}

/** Hinweise aus den Angaben (Anti-Ziel 1: warnen, nie sperren). `heldOn` ist der Tag der Versammlung bzw. des Beschlusses. */
export function detailWarningsInternal(db: DbOrTx, row: Pick<ResolutionRow, 'kind' | 'details' | 'decidedOn' | 'organId'> & { id?: string | null }, rules: StatuteRules): DetailWarning[] {
  const d = row.details as Record<string, unknown> | null;
  if (!d) return DETAILS_NEEDED.includes(row.kind) ? ['detailsMissing'] : [];
  if (row.kind === 'statute' || row.kind === 'purpose') return statuteResolutionWarningsInternal(db, row);
  if (row.kind === 'remuneration') {
    const details = d as z.infer<typeof remunerationDetailsSchema>;
    const offices = details.officeIds.length > 0 ? db.select({ organId: governanceOffices.organId }).from(governanceOffices).where(inArray(governanceOffices.id, details.officeIds)).all() : [];
    const involved = [...new Set([row.organId, details.decidedByOrganId, ...offices.map((o) => o.organId)])];
    if (remunerationWithoutStatute(rules, involved)) return ['remunerationWithoutStatute'];
    return remunerationWrongOrgan(remunerationDeciders(rules, involved), row.organId, involved) ? ['remunerationWrongOrgan'] : [];
  }
  if (row.kind === 'expenseRule') return (d as z.infer<typeof expenseRuleDetailsSchema>).validFrom < row.decidedOn ? ['expenseRuleRetroactive'] : [];
  if (row.kind === 'exclusion') {
    const details = d as z.infer<typeof exclusionDetailsSchema>;
    const open = [details.statuteGround, details.reasonsSentOn, details.hearingOn, details.reasonsDocumentId, details.noticeReceivedOn].some((v) => v === null);
    const days = resolveRule(rules, row.organId, 'exclusionNoticeDays').value;
    const late = days !== undefined && details.reasonsSentOn !== null && details.reasonsSentOn > addCalendarDays(row.decidedOn, -days);
    return open || late ? ['exclusionChecklistOpen'] : [];
  }
  return [];
}
