import { z } from 'zod';

/**
 * Beschlussarten (Spec Gremien § 4.2) — fest im Code, weil Regeln und Folgen daran hängen. G3 nutzt sie für die
 * Tagesordnung.
 */
export const RESOLUTION_KINDS = [
  'simple',
  'agenda',
  'minutesApproval',
  'statute',
  'purpose',
  'dissolution',
  'election',
  'dismissal',
  'discharge',
  'accounts',
  'feeSchedule',
  'exclusion',
  'honoraryMember',
  'mandate',
  'reserve',
  'remuneration',
  'expenseRule',
] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

/** Ein Bruch, höchstens 1 (1 ≤ num ≤ den ≤ 100). */
export const fractionSchema = z
  .object({ num: z.number().int().min(1).max(100), den: z.number().int().min(1).max(100) })
  .refine((f) => f.num <= f.den, { message: 'fractionAboveOne', path: ['num'] });
export type Fraction = z.infer<typeof fractionSchema>;

/**
 * Vergleich eines Bruchs (Designer Phase 2, Joe 2026-10-28): „mindestens 2/3“ oder „mehr als 2/3“. Bestehende Regeln
 * ohne Angabe meinen „mindestens“.
 */
export const comparisonSchema = z.enum(['atLeast', 'moreThan']).default('atLeast');
export type Comparison = z.output<typeof comparisonSchema>;

/**
 * Mehrheit: Bruch (oder einfache Mehrheit) bezogen auf abgegebene, anwesende oder alle Stimmen; Enthaltungen übergangen
 * oder als Nein. `comparison` gilt nur für einen Bruch — `simple` bleibt „mehr Ja als Rest“.
 */
export const majoritySchema = z.object({
  fraction: z.union([z.literal('simple'), fractionSchema]),
  base: z.enum(['cast', 'present', 'all']),
  abstentions: z.enum(['ignored', 'asNo']),
  comparison: comparisonSchema,
});
/** Eingabeform: `comparison` darf fehlen (gespeicherte Regeln vor 0.5.0, Rückfallwerte) und heißt dann „mindestens“. */
export type Majority = z.input<typeof majoritySchema>;

const quorumSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('fraction'), fraction: fractionSchema, base: z.enum(['allMembers', 'votingMembers', 'organMembers']), comparison: comparisonSchema }),
  z.object({ kind: z.literal('absolute'), count: z.number().int().min(1).max(1000) }),
]);

const days = z.number().int().min(0).max(365);

/** Regeln eines Organs (Spec § 4.2). Jeder Wert ist optional; fehlt er, gilt der Rückfallwert (`law.ts`). */
export const organRulesSchema = z.strictObject({
  convenedBy: z.strictObject({ organId: z.string().min(1).optional(), officeIds: z.array(z.string().min(1)).max(20).optional() }).optional(),
  noticeDays: days.optional(),
  noticeStrictness: z.enum(['must', 'should']).optional(),
  noticeFrom: z.enum(['sent', 'received']).optional(),
  transitDays: z.strictObject({ email: z.number().int().min(0).max(30), post: z.number().int().min(0).max(30) }).optional(),
  form: z.enum(['textForm', 'letter', 'publication']).optional(),
  agendaWithInvitation: z.boolean().optional(),
  motionDeadlineDays: days.optional(),
  lateMotionMajority: majoritySchema.optional(),
  announceRequired: z.union([z.literal('all'), z.array(z.enum(RESOLUTION_KINDS))]).optional(),
  quorum: quorumSchema.optional(),
  repeatMeeting: z.strictObject({ withinDays: days, noQuorum: z.boolean() }).nullable().optional(),
  majorities: z.partialRecord(z.enum(RESOLUTION_KINDS), majoritySchema).optional(),
  tie: z.enum(['rejected', 'chairDecides']).optional(),
  election: z.strictObject({ mode: z.enum(['single', 'block']), rounds: z.array(majoritySchema).min(1).max(5), runoff: z.boolean() }).optional(),
  /** Office-IDs in der Reihenfolge, in der sie die Sitzung leiten. */
  chairOrder: z.array(z.string().min(1)).max(20).optional(),
  /** `chair`, `minuteTaker` oder eine Office-ID. */
  minutesSignedBy: z.array(z.string().min(1)).max(10).optional(),
  formsAllowed: z.array(z.enum(['inPerson', 'hybrid', 'virtual'])).max(3).optional(),
  circular: z.strictObject({ allowed: z.boolean(), consent: z.union([z.literal('all'), majoritySchema]), form: z.literal('textForm') }).nullable().optional(),
  minorityRequest: fractionSchema.optional(),
  substitutionAllowed: z.boolean().optional(),
  officeRequiresMembership: z.boolean().optional(),
  remuneration: z.strictObject({ statuteReference: z.string().trim().min(1).max(200), decidedBy: z.string().min(1) }).nullable().optional(),
  exclusionNoticeDays: days.optional(),
  /** Ordentliche Versammlung mindestens einmal im Kalenderjahr (Spec § 11, Plan G2). */
  ordinaryMeetingYearly: z.boolean().optional(),
  /**
   * Vertretung des Vereins durch den Vorstand (§ 26 Abs. 1 S. 2 BGB, Designer Phase 2, Joe 2026-10-28): einzeln, zu
   * zweit oder alle gemeinsam, dazu der Wortlaut. `majority` ist der Rückfall nach § 26 Abs. 2 S. 1 BGB und darf auch
   * ausdrücklich in der Satzung stehen.
   */
  representation: z.strictObject({ mode: z.enum(['single', 'two', 'all', 'majority']), text: z.string().trim().min(1).max(500).optional() }).optional(),
});
/** Eingabeform, damit Regeln ohne `comparison` (Vorgabe „mindestens“) gültig getippt bleiben. */
export type OrganRules = z.input<typeof organRulesSchema>;
export type OrganRuleKey = keyof OrganRules;

const ORGAN_RULE_KEYS = Object.keys(organRulesSchema.shape) as OrganRuleKey[];
/** Schlüssel einer Fundstelle: eine Regel oder die Mehrheit einer Beschlussart. */
export const REFERENCE_KEYS = [...ORGAN_RULE_KEYS, ...RESOLUTION_KINDS.map((k) => `majorities.${k}` as const)] as const;
export type ReferenceKey = OrganRuleKey | `majorities.${ResolutionKind}`;

/**
 * Regelwerk eines Satzungsstands: je Organ-ID die Regeln, dazu je Organ und Regel die Fundstelle in der Satzung
 * („§ 13 Abs. 1 Satzung“, Joe 2026-10-28).
 */
export const rulesSchema = z.strictObject({
  organs: z.record(z.string().min(1), organRulesSchema),
  references: z.record(z.string().min(1), z.partialRecord(z.enum(REFERENCE_KEYS as unknown as [string, ...string[]]), z.string().trim().min(1).max(200))).optional(),
  /** Anfallberechtigter bei Auflösung (§ 55 Abs. 1 Nr. 4, § 61 AO) im Wortlaut der Satzung — vereinsweit, kein Organ (Plan G5). */
  assetBeneficiary: z.string().trim().min(1).max(500).optional(),
});
export type StatuteRules = { organs: Record<string, OrganRules>; references?: Record<string, Partial<Record<ReferenceKey, string>>>; assetBeneficiary?: string };

/**
 * Mindestzahl für einen Bruch einer Bezugsgröße: „mindestens“ rundet auf, „mehr als“ braucht die nächste ganze Zahl
 * über dem Bruch (2/3 von 9: mindestens 6, mehr als 7).
 */
export function fractionNeeded(fraction: Fraction, total: number, comparison: Comparison | undefined): number {
  const product = fraction.num * total;
  return comparison === 'moreThan' ? Math.floor(product / fraction.den) + 1 : Math.ceil(product / fraction.den);
}

export const EMPTY_RULES: StatuteRules = { organs: {} };
