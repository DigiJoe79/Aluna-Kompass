import { z } from 'zod';
import { animalProposalImages, animalProposals, NOTICE_KINDS, PROPOSAL_KINDS, type PhotoCrop } from '../schema';
import type { ValidationIssue } from '@kompass/core';
import { animalCreateSchema, animalStatusSchema, animalUpdateSchema, cropIssues, MAX_ANIMAL_PHOTOS, photoCropSchema, type AnimalRecord } from '../service';

/**
 * Felder, die eine Quelle vorschlagen kann (Spec Vorschlags-Eingang § 2): alle Felder der Maske und der Status.
 * Reihenfolge = Reihenfolge der Gegenüberstellung.
 */
export const PROPOSAL_FIELDS = ['name', 'sex', 'birthText', 'sizeCm', 'sizeText', 'location', 'place', 'isEmergency', 'isSponsorable', 'traits', 'externalProfileUrl', 'summary', 'body', 'status'] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];
export type BaselineKey = ProposalField | 'photos';
export type ProposalRow = typeof animalProposals.$inferSelect;
export type ProposalImageRow = typeof animalProposalImages.$inferSelect;

const year = z.number().int().min(2000).max(2100);
const extra = { status: animalStatusSchema.shape.status.optional(), adoptedYear: year.optional() };
/** Werte eines neuen Hundes: alle Felder der Maske (Spec § 2), dazu Status. */
export const createValuesSchema = animalCreateSchema.extend(extra).strict();
/** Werte einer Änderung: nur die geänderten Felder; Sprachfassungen eines Feldes zusammen (ganze Karte). */
export const updateValuesSchema = animalUpdateSchema.omit({ id: true, expectedVersion: true }).extend(extra).strict();

/** Zweifelsfall der Quelle (A5): Titel und/oder Feld (prüft `proposalRuleIssues`), Zitat aus der Quelle, Vorschlag. */
export const proposalHintSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    field: z.enum([...PROPOSAL_FIELDS, 'photos']).optional(),
    quote: z.string().trim().max(1000).default(''),
    suggestion: z.string().trim().max(500).default(''),
  })
  .strict();

/** Ein Foto der Liste: bereitgestelltes Bild (`imageId`) oder vorhandenes Foto des Tiers (`mediaId`), nie beides (prüft `proposalRuleIssues`). */
export const proposalPhotoSchema = z
  .object({
    imageId: z.string().min(1).optional(),
    mediaId: z.string().min(1).optional(),
    sourceRef: z.string().trim().min(1).max(200).optional(),
    isPrimary: z.boolean().default(false),
    crop: photoCropSchema.nullable().optional(),
  })
  .strict();

/** Ein Foto ist genau eins von beidem: bereitgestelltes Bild oder Foto des Tiers. */
export function photoRefIssues(photos: readonly { imageId?: string; mediaId?: string }[], base: string): ValidationIssue[] {
  return photos.flatMap((p, i) => ((p.imageId === undefined) === (p.mediaId === undefined) ? [{ path: `${base}.${i}.imageId`, message: 'photoRefAmbiguous' }] : []));
}

/**
 * Regeln über mehrere Felder, die bewusst nicht im Schema stehen (Werkzeugschemas ohne `refine`, Wächter N5):
 * Zweifelsfall mit Titel oder Feld, Foto mit genau einer Kennung, Ausschnitt im Bild.
 */
export function proposalRuleIssues(p: { hints?: readonly { title?: string; field?: string }[]; photos?: readonly { imageId?: string; mediaId?: string; crop?: PhotoCrop | null }[] }): ValidationIssue[] {
  return [
    ...(p.hints ?? []).flatMap((h, i) => (h.title === undefined && h.field === undefined ? [{ path: `hints.${i}.title`, message: 'hintNeedsTitleOrField' }] : [])),
    ...photoRefIssues(p.photos ?? [], 'photos'),
    ...cropIssues(p.photos ?? [], 'photos'),
  ];
}

const ref = z.string().trim().min(1).max(200);
const common = { sourceKey: ref, externalUrl: z.url().max(500).optional(), trailUrl: z.url().max(500).optional() };
const photos = z.array(proposalPhotoSchema).max(MAX_ANIMAL_PHOTOS).optional();
const hints = z.array(proposalHintSchema).max(30).default([]);
const reason = z.string().trim().min(1).max(2000);
/** Die vier Arten mit ihren Pflichtfeldern — danach prüft der Dienst. */
export const proposalSubmitUnion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), ...common, externalRef: ref, values: createValuesSchema, hints, photos }).strict(),
  z.object({ kind: z.literal('update'), ...common, externalRef: ref.optional(), animalId: z.string().min(1), values: updateValuesSchema.default({}), hints, photos }).strict(),
  z.object({ kind: z.literal('notice'), ...common, externalRef: ref.optional(), animalId: z.string().min(1), reason, noticeKind: z.enum(NOTICE_KINDS).optional() }).strict(),
  z.object({ kind: z.literal('sameAs'), ...common, externalRef: ref, animalId: z.string().min(1), reason, values: updateValuesSchema.default({}), photos }).strict(),
]);

/**
 * Das Schema des Werkzeugs: ein Objekt, keine Union und keine Prüfung über mehrere Felder — MCP-Clients verlangen
 * auf oberster Ebene ein Objekt (M11), und eine bedingte Pflicht beantwortete das SDK englisch vor dem Dienst (N5).
 * Welche Felder je Art Pflicht oder verboten sind, prüft der Dienst mit der Union oben.
 */
export const proposalSubmitSchema = z
  .object({
    kind: z.enum(PROPOSAL_KINDS),
    ...common,
    externalRef: ref.optional(),
    animalId: z.string().min(1).optional(),
    /** create: alle Felder der Maske; update/sameAs: nur die geänderten. */
    values: updateValuesSchema.optional(),
    hints: z.array(proposalHintSchema).max(30).optional(),
    photos,
    reason: reason.optional(),
    noticeKind: z.enum(NOTICE_KINDS).optional(),
  })
  .strict();
export type ProposalSubmitInput = z.output<typeof proposalSubmitUnion>;

/** JSON mit sortierten Objektschlüsseln: Sprachkarten gleichen sich unabhängig von der Reihenfolge, Listen nicht. */
export function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Die vorgeschlagenen Felder in der Reihenfolge der Gegenüberstellung, ohne `adoptedYear`. */
export const proposedFields = (values: Record<string, unknown> | null): ProposalField[] => PROPOSAL_FIELDS.filter((f) => values !== null && f in values);

/** `photos` vergleicht Reihenfolge und Titelbild, nicht Ausschnitt oder Herkunft (die ändert nur ein Vorschlag selbst). */
export function fieldValueOf(animal: AnimalRecord, key: BaselineKey): unknown {
  return key === 'photos' ? animal.photos.map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary })) : animal[key];
}
export const baselineOf = (animal: AnimalRecord, keys: readonly BaselineKey[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, fieldValueOf(animal, k)]));
/** Felder, die seit dem Vorschlag in Kompass geändert wurden (A16). */
export const conflictKeys = (baseline: Record<string, unknown> | null, animal: AnimalRecord): BaselineKey[] =>
  Object.keys(baseline ?? {}).filter((k) => !sameValue(baseline![k], fieldValueOf(animal, k as BaselineKey))) as BaselineKey[];

/** Name für Protokoll und Liste: der heutige des Tiers, bei neuem Hund der vorgeschlagene, nach dem Leeren ''. */
export function proposalName(p: Pick<ProposalRow, 'kind' | 'values'>, animal: { name: string } | null): string {
  if (animal) return animal.name;
  const proposed = p.values?.name;
  return typeof proposed === 'string' ? proposed : '';
}
