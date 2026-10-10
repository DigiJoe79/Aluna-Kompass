import { notFound, ok, requirePermission, schema, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, asc, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { animalPhotos, animalProposalImages, animalProposals, animals, PROPOSAL_KINDS, PROPOSAL_STATES, type NoticeKind, type ProposalFinal, type ProposalHint, type ProposalKind, type ProposalState } from '../schema';
import { loadAnimal, type AnimalRecord } from '../service';
import { conflictKeys, fieldValueOf, proposalName, proposedFields, sameValue, type BaselineKey, type ProposalField, type ProposalRow } from './model';
import { originsOf, type AnimalOrigin } from './origins';
import { photoRows, type PhotoRow } from './photos';

export const proposalListSchema = z
  .object({
    /** `decided` = alles außer offen; Vorgabe offen (Spec § 6). */
    state: z.enum(['decided', 'all', ...PROPOSAL_STATES]).default('open'),
    kind: z.enum(PROPOSAL_KINDS).optional(),
    sourceUserId: z.string().min(1).optional(),
    animalId: z.string().min(1).optional(),
    text: z.string().trim().max(80).optional(),
  })
  .strict();

export interface ProposalListItem {
  id: string;
  kind: ProposalKind;
  state: ProposalState;
  sourceUserId: string;
  sourceName: string;
  animalId: string | null;
  /** Heutiger Name, bei neuem Hund der vorgeschlagene, nach dem Leeren ''. */
  name: string;
  /** Der Name, den die Quelle nennt (`values.name`), sonst ''; bei Zuordnung „„Junah“ ist vermutlich dieser Hund“. */
  proposedName: string;
  /** Heutiges Titelbild des Tiers. */
  primaryAssetId: string | null;
  /**
   * Titelbild aus den bereitgestellten Bildern des Vorschlags (das mit `isPrimary`, sonst das erste nach Position),
   * solange die Datei noch liegt — für die Inbox, wenn das Tier keins hat (neuer Hund).
   */
  primaryImageId: string | null;
  /** „Inhalt“: die vorgeschlagenen Felder. */
  fields: ProposalField[];
  photoCount: number;
  newPhotoCount: number;
  conflictCount: number;
  hintCount: number;
  /** Nur bei neuem Hund: Titelbild bzw. Kurztext der Leitsprache fehlt. */
  missing: ('primaryPhoto' | 'summary')[];
  noticeKind: NoticeKind | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Aus dem Protokoll (A30). */
  decidedByUserId: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  decisionReason: 'animalDeleted' | null;
  cleared: boolean;
}

export interface ProposalList {
  /** Älteste zuerst. */
  proposals: ProposalListItem[];
  /** Ungefiltert: Zahl am Reiter und Kachel (Spec § 6). */
  open: { count: number; oldestAt: string | null; withConflict: number };
  /** Für den Filter „Quelle“: Quellen offener Vorschläge, nach Name sortiert. */
  sources: { userId: string; name: string }[];
}

const DECISION_ACTIONS = ['animals.proposal.accept', 'animals.proposal.acceptWithChanges', 'animals.proposal.reject', 'animals.proposal.withdraw'];

/** Namen der Nutzer in einer Abfrage. */
function userNames(deps: Deps, ids: readonly string[]): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, unique)).all().map((u) => [u.id, u.name]));
}

/** Die Zeilen der Inbox: je Vorschlag Quelle, Hund, Inhalt, Zähler, Entscheider (Plan B baut daraus Liste, Marke, Kachel). */
function listItems(deps: Deps, rows: readonly ProposalRow[]): ProposalListItem[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const animalIds = [...new Set(rows.flatMap((r) => (r.animalId ? [r.animalId] : [])))];
  const names = new Map(animalIds.length ? deps.db.select({ id: animals.id, name: animals.name }).from(animals).where(inArray(animals.id, animalIds)).all().map((a) => [a.id, a.name]) : []);
  const primaries = new Map<string, string>();
  if (animalIds.length) {
    for (const p of deps.db.select({ animalId: animalPhotos.animalId, assetId: animalPhotos.assetId, isPrimary: animalPhotos.isPrimary }).from(animalPhotos).where(inArray(animalPhotos.animalId, animalIds)).orderBy(asc(animalPhotos.sortOrder)).all()) {
      if (p.isPrimary || !primaries.has(p.animalId)) primaries.set(p.animalId, p.assetId);
    }
  }
  const images = new Map<string, { all: number; fresh: number; primary: boolean; cover: string | null; coverIsPrimary: boolean }>();
  for (const i of deps.db
    .select({ id: animalProposalImages.id, proposalId: animalProposalImages.proposalId, mediaId: animalProposalImages.mediaId, filename: animalProposalImages.filename, isPrimary: animalProposalImages.isPrimary })
    .from(animalProposalImages)
    .where(inArray(animalProposalImages.proposalId, ids))
    .orderBy(asc(animalProposalImages.position))
    .all()) {
    const entry = images.get(i.proposalId!) ?? { all: 0, fresh: 0, primary: false, cover: null, coverIsPrimary: false };
    entry.all += 1;
    if (i.mediaId === null) entry.fresh += 1;
    entry.primary ||= i.isPrimary;
    // Nur bereitgestellte Bilder, deren Datei noch liegt (nach der Entscheidung ist sie weg).
    if (i.mediaId === null && i.filename !== null && (entry.cover === null || (i.isPrimary && !entry.coverIsPrimary))) {
      entry.cover = i.id;
      entry.coverIsPrimary = i.isPrimary;
    }
    images.set(i.proposalId!, entry);
  }
  const decided = new Map<string, string | null>();
  const decidedIds = rows.filter((r) => r.state !== 'open').map((r) => r.id);
  if (decidedIds.length) {
    for (const e of deps.db
      .select({ entityId: schema.auditLog.entityId, userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'animalProposal'), inArray(schema.auditLog.entityId, decidedIds), inArray(schema.auditLog.action, DECISION_ACTIONS)))
      .orderBy(asc(schema.auditLog.occurredAt), asc(schema.auditLog.id))
      .all()) {
      decided.set(e.entityId!, e.userId);
    }
  }
  const people = userNames(deps, [...rows.map((r) => r.sourceUserId), ...[...decided.values()].filter((u): u is string => !!u)]);
  const leading = deps.locales()[0] ?? 'de';
  return rows.map((r) => {
    const animal = r.state === 'open' && r.kind === 'update' && r.animalId ? loadAnimal(deps.db, r.animalId) : null;
    const img = images.get(r.id);
    const summary = (r.values?.summary as Record<string, string> | undefined)?.[leading] ?? '';
    const missing: ProposalListItem['missing'] = r.kind === 'create' && r.state === 'open' ? [...(img ? [] : (['primaryPhoto'] as const)), ...(summary.trim() ? [] : (['summary'] as const))] : [];
    const decider = decided.get(r.id) ?? null;
    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      sourceUserId: r.sourceUserId,
      sourceName: people.get(r.sourceUserId) ?? '',
      animalId: r.animalId,
      name: r.animalId && names.has(r.animalId) ? names.get(r.animalId)! : proposalName(r, null),
      proposedName: proposalName(r, null),
      primaryAssetId: r.animalId ? (primaries.get(r.animalId) ?? null) : null,
      primaryImageId: img?.cover ?? null,
      fields: proposedFields(r.values),
      photoCount: img?.all ?? 0,
      newPhotoCount: img?.fresh ?? 0,
      conflictCount: animal ? conflictKeys(r.baseline, animal).length : 0,
      hintCount: r.hints?.length ?? 0,
      missing,
      noticeKind: r.noticeKind,
      reason: r.reason,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      decidedByUserId: decider,
      decidedByName: decider ? (people.get(decider) ?? null) : null,
      decisionNote: r.decisionNote,
      decisionReason: r.decisionReason,
      cleared: r.clearedAt !== null,
    };
  });
}

/** Die Inbox (Spec § 6): gefiltert, älteste zuerst; Zähler und Quellen ungefiltert über alle offenen. Nur `animals.manage`. */
export async function listProposals(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<ProposalList>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, proposalListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { state, kind, sourceUserId, animalId, text } = parsed.value;
  const order = [asc(animalProposals.createdAt), asc(animalProposals.id)];
  const openRows = deps.db.select().from(animalProposals).where(eq(animalProposals.state, 'open')).orderBy(...order).all();
  const openItems = listItems(deps, openRows);
  const rows =
    state === 'open'
      ? openRows.filter((r) => (!kind || r.kind === kind) && (!sourceUserId || r.sourceUserId === sourceUserId) && (!animalId || r.animalId === animalId))
      : deps.db
          .select()
          .from(animalProposals)
          .where(
            and(
              state === 'all' ? undefined : state === 'decided' ? ne(animalProposals.state, 'open') : eq(animalProposals.state, state),
              kind ? eq(animalProposals.kind, kind) : undefined,
              sourceUserId ? eq(animalProposals.sourceUserId, sourceUserId) : undefined,
              animalId ? eq(animalProposals.animalId, animalId) : undefined,
            ),
          )
          .orderBy(...order)
          .all();
  const byId = new Map(openItems.map((i) => [i.id, i]));
  const items = state === 'open' ? rows.map((r) => byId.get(r.id)!) : listItems(deps, rows);
  const needle = (text ?? '').toLocaleLowerCase('de');
  const sources = [...new Map(openItems.map((i) => [i.sourceUserId, i.sourceName])).entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  return ok({
    proposals: needle ? items.filter((i) => i.name.toLocaleLowerCase('de').includes(needle)) : items,
    open: { count: openRows.length, oldestAt: openRows[0]?.createdAt ?? null, withConflict: openItems.filter((i) => i.conflictCount > 0).length },
    sources,
  });
}

type ChangedBy = { userId: string | null; userName: string | null; at: string };

export interface ProposalFieldRow {
  field: ProposalField;
  current: unknown;
  proposed: unknown;
  baseline: unknown;
  conflict: { changedBy: ChangedBy | null } | null;
  hints: ProposalHint[];
}

export interface ProposalReview {
  proposal: ProposalListItem & { externalRef: string | null; externalUrl: string | null; trailUrl: string | null; sourceKey: string; values: Record<string, unknown> | null; sameAsAnswer: 'same' | 'different' | null; final: ProposalFinal | null };
  /** Heute; `null` bei neuem Hund. */
  animal: AnimalRecord | null;
  /** Änderung: nur vorgeschlagene Felder; neuer Hund: alle Werte ohne Stand beim Vorschlag und Konflikt. */
  fields: ProposalFieldRow[];
  photos: (PhotoRow & { conflict: boolean })[] | null;
  photoConflict: { changedBy: ChangedBy | null } | null;
  /** Zweifelsfälle ohne Feld oder zum Feld `photos`. */
  generalHints: ProposalHint[];
  /** Neuer Hund: „Es gibt schon eine Lotte“. */
  sameNameAnimals: { id: string; name: string }[];
  /** Herkunft des Ziel-Tiers. */
  origins: AnimalOrigin[];
}

/**
 * Wer ein Feld des Tiers seit `since` zuletzt geändert hat, aus dem Protokoll (Spec § 3: „seit dem Vorschlag in
 * Kompass geändert · Person, Zeit“). Gesucht wird der jüngste Eintrag, dessen Nachher den Schlüssel trägt und dessen
 * Vorher ihn nicht oder anders trägt; `photos` zählt Reihenfolge und Titelbild wie `fieldValueOf`.
 */
export function changedSince(deps: Deps, animalId: string, since: string, key: BaselineKey): ChangedBy | null {
  const rows = deps.db
    .select({ userId: schema.auditLog.userId, occurredAt: schema.auditLog.occurredAt, before: schema.auditLog.before, after: schema.auditLog.after })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, 'animal'), eq(schema.auditLog.entityId, animalId), gt(schema.auditLog.occurredAt, since)))
    .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.id))
    .all();
  const norm = (v: unknown) => (key === 'photos' && Array.isArray(v) ? v.map((p: { assetId: string; isPrimary: boolean }) => ({ assetId: p.assetId, isPrimary: p.isPrimary })) : v);
  for (const r of rows) {
    const after = r.after ? (JSON.parse(r.after) as Record<string, unknown>) : null;
    if (!after || !(key in after)) continue;
    const before = r.before ? (JSON.parse(r.before) as Record<string, unknown>) : null;
    if (before && key in before && sameValue(norm(before[key]), norm(after[key]))) continue;
    return { userId: r.userId, userName: r.userId ? (userNames(deps, [r.userId]).get(r.userId) ?? null) : null, at: r.occurredAt };
  }
  return null;
}

/** Ein Vorschlag neben dem Tier von heute (Prüfseite, Plan B). Nur `animals.manage`. */
export async function getProposal(deps: Deps, ctx: CallContext, id: string): Promise<Result<ProposalReview>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const row = deps.db.select().from(animalProposals).where(eq(animalProposals.id, id)).get();
  if (!row) return notFound('animalProposal', id);
  const [item] = listItems(deps, [row]);
  const animal = row.animalId ? loadAnimal(deps.db, row.animalId) : null;
  const values = row.values ?? null;
  const hints = row.hints ?? [];
  const conflicts = animal && row.state === 'open' ? conflictKeys(row.baseline, animal) : [];
  const fields: ProposalFieldRow[] = proposedFields(values).map((f) =>
    row.kind === 'create' || !animal
      ? { field: f, current: null, proposed: values![f], baseline: null, conflict: null, hints: hints.filter((h) => h.field === f) }
      : {
          field: f,
          current: fieldValueOf(animal, f),
          proposed: values![f],
          baseline: row.baseline?.[f] ?? null,
          conflict: conflicts.includes(f) ? { changedBy: changedSince(deps, animal.id, row.createdAt, f) } : null,
          hints: hints.filter((h) => h.field === f),
        },
  );
  const images = deps.db.select().from(animalProposalImages).where(eq(animalProposalImages.proposalId, row.id)).orderBy(asc(animalProposalImages.position)).all();
  const hasPhotos = images.length > 0 || (row.baseline !== null && 'photos' in row.baseline);
  let photos: ProposalReview['photos'] = null;
  if (hasPhotos) {
    const base = photoRows(row.sourceUserId, images, row.kind === 'create' ? null : (animal?.photos ?? []));
    const mediaIds = base.flatMap((p) => (p.mediaId && p.width === null ? [p.mediaId] : []));
    const sizes = new Map(mediaIds.length ? deps.db.select({ id: schema.mediaAssets.id, width: schema.mediaAssets.width, height: schema.mediaAssets.height }).from(schema.mediaAssets).where(inArray(schema.mediaAssets.id, mediaIds)).all().map((m) => [m.id, m]) : []);
    const baselinePhotos = (row.baseline?.photos as { assetId: string; isPrimary: boolean }[] | undefined) ?? null;
    const photosChanged = conflicts.includes('photos');
    photos = base.map((p) => {
      const size = p.mediaId ? sizes.get(p.mediaId) : undefined;
      const was = baselinePhotos?.find((b) => b.assetId === p.mediaId);
      return {
        ...p,
        width: p.width ?? size?.width ?? null,
        height: p.height ?? size?.height ?? null,
        // Ein Foto des Tiers, das seit dem Vorschlag dazukam oder sein Titelbild-Sein änderte.
        conflict: photosChanged && p.mediaId !== null && p.imageId === null && p.change !== 'new' && (!was || was.isPrimary !== p.currentPrimary),
      };
    });
  }
  const proposedName = typeof values?.name === 'string' ? values.name : null;
  const sameNameAnimals =
    row.kind === 'create' && proposedName
      ? deps.db
          .select({ id: animals.id, name: animals.name })
          .from(animals)
          .all()
          .filter((a) => a.name.localeCompare(proposedName, 'de', { sensitivity: 'base' }) === 0)
      : [];
  return ok({
    proposal: { ...item!, externalRef: row.externalRef, externalUrl: row.externalUrl, trailUrl: row.trailUrl, sourceKey: row.sourceKey, values, sameAsAnswer: row.sameAsAnswer, final: row.final ?? null },
    animal,
    fields,
    photos,
    photoConflict: conflicts.includes('photos') && animal ? { changedBy: changedSince(deps, animal.id, row.createdAt, 'photos') } : null,
    generalHints: hints.filter((h) => h.field === undefined || h.field === 'photos'),
    sameNameAnimals,
    origins: animal ? originsOf(deps.db, animal.id) : [],
  });
}
