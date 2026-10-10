import {
  expectedVersionField,
  invalid,
  isoNow,
  localizedConflict,
  notFound,
  ok,
  readSetting,
  recordAudit,
  requirePermission,
  staleVersion,
  storeMediaInternal,
  todayIn,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { animalProposalImages, animalProposals, type PhotoCrop, type ProposalFinal, type ProposalState } from '../schema';
import {
  insertAnimalTx,
  loadAnimal,
  cropIssues,
  imageState,
  MAX_ANIMAL_PHOTOS,
  photoCropSchema,
  replacePhotosTx,
  roundCrop,
  setPublishedTx,
  setStatusTx,
  updateAnimalTx,
  type AnimalChanges,
  type AnimalCreateValues,
  type AnimalRecord,
  type AnimalStatus,
  type PhotoWrite,
} from '../service';
import { PROPOSAL_PHOTO_FOLDER_KEY } from '../settings';
import { proposalAudit, releaseImages } from './audit';
import { deleteProposalFiles } from './images';
import { conflictKeys, createValuesSchema, fieldValueOf, photoRefIssues, PROPOSAL_FIELDS, proposedFields, sameValue, updateValuesSchema, type ProposalField, type ProposalImageRow, type ProposalRow } from './model';
import { upsertOrigin } from './origins';
import { defaultPhotoChoice, photoChoiceDiffers, photoRows, type PhotoChoice } from './photos';
import { loadProposal, nameOf, statusItemOf, type ProposalStatusItem } from './submit';

/** Genau eine Kennung je Foto und Ausschnitt im Bild prüft der Dienst (Werkzeugschemas ohne `refine`, N5). */
const acceptPhotoSchema = z.object({ imageId: z.string().min(1).optional(), mediaId: z.string().min(1).optional(), isPrimary: z.boolean().default(false), crop: photoCropSchema.nullable().optional() }).strict();

export const proposalAcceptSchema = z
  .object({
    id: z.string().min(1),
    /** Je vorgeschlagenem Feld: übernehmen oder heutigen Stand behalten. Ohne Angabe: Vorschlag, bei Konflikt heute (Spec § 3). */
    fields: z.record(z.string(), z.enum(['proposal', 'current'])).optional(),
    /** Vom Prüfer bearbeitete Werte; gehen vor `fields`. Änderung: nur vorgeschlagene Felder. Neuer Hund: alle Felder der Maske. */
    values: z.record(z.string(), z.unknown()).optional(),
    /** Die ganze Fotoliste danach; ohne Angabe die Vorauswahl (`defaultPhotoChoice`). */
    photos: z.array(acceptPhotoSchema).optional(),
    publish: z.boolean().optional(),
    sameAsAnswer: z.enum(['same', 'different']).optional(),
    adoptedYear: z.number().int().min(2000).max(2100).optional(),
    /** Ladestand des Tiers (`updatedAt`) in der Prüfung; veraltet → `staleVersion`. */
    expectedVersion: expectedVersionField,
  })
  .strict();

export interface ProposalAcceptResult {
  proposal: ProposalStatusItem;
  animalId: string | null;
  keptForConflict: string[];
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Der Vorschlag ist noch offen? Sonst die Ablehnung mit seinem Zustand. */
function openProposal(deps: Deps, id: string): Result<ProposalRow> {
  const row = loadProposal(deps.db, id);
  if (!row) return notFound('animalProposal', id);
  if (row.state !== 'open') return localizedConflict('proposalNotOpen', 'errors.animalProposals.proposalNotOpen', { state: row.state });
  return ok(row);
}

/**
 * Einen Vorschlag annehmen (Spec § 3): bei neuem Hund und Änderung die Werte ins Tier, gewählte Bilder in die
 * Mediathek, Herkunft, Endfassung. Weicht die Annahme vom Vorschlag ab → `acceptedWithChanges`. Hinweis: zur
 * Kenntnis genommen. Zuordnung: Antwort `same` (Herkunft am Tier) oder `different`. Alles in einer Transaktion über
 * dieselben Schreibhelfer wie die Tier-Dienste — Protokoll, Prüfmerker und Statusregeln gelten so ohne zweiten Weg.
 */
export async function acceptProposal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProposalAcceptResult>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, proposalAcceptSchema, input);
  if (!parsed.ok) return parsed;
  const a = parsed.value;
  const rules = [...photoRefIssues(a.photos ?? [], 'photos'), ...cropIssues(a.photos ?? [], 'photos')];
  if (rules.length) return invalid(rules);
  const found = openProposal(deps, a.id);
  if (!found.ok) return found;
  const row = found.value;

  if (row.kind === 'notice') {
    const files: string[] = [];
    const updated = deps.db.transaction((tx) => {
      const now = isoNow(deps.clock);
      tx.update(animalProposals).set({ state: 'accepted', decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
      files.push(...releaseImages(tx, row.id));
      recordAudit(tx, deps, ctx, { action: 'animals.proposal.accept', entityType: 'animalProposal', ...proposalAudit(row, nameOf(tx, row), 'accepted') });
      return loadProposal(tx, row.id)!;
    });
    await deleteProposalFiles(deps, files);
    return ok({ proposal: statusItemOf(updated), animalId: row.animalId, keptForConflict: [] });
  }

  if (row.kind === 'sameAs') {
    if (!a.sameAsAnswer) return invalid([{ path: 'sameAsAnswer', message: 'required' }]);
    const target = loadAnimal(deps.db, row.animalId!);
    if (!target) return notFound('animal', row.animalId!);
    const same = a.sameAsAnswer === 'same';
    const files: string[] = [];
    const updated = deps.db.transaction((tx) => {
      const now = isoNow(deps.clock);
      if (same) upsertOrigin(tx, deps, { animalId: target.id, sourceUserId: row.sourceUserId, externalRef: row.externalRef!, externalUrl: row.externalUrl });
      const final: ProposalFinal = { animalId: same ? target.id : null, values: {}, photos: null, isPublished: null };
      tx.update(animalProposals).set({ state: 'accepted', sameAsAnswer: a.sameAsAnswer, final, decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
      files.push(...releaseImages(tx, row.id));
      recordAudit(tx, deps, ctx, { action: 'animals.proposal.accept', entityType: 'animalProposal', ...proposalAudit(row, target.name, 'accepted') });
      return loadProposal(tx, row.id)!;
    });
    await deleteProposalFiles(deps, files);
    return ok({ proposal: statusItemOf(updated), animalId: target.id, keptForConflict: [] });
  }

  return acceptValues(deps, ctx, row, a);
}

async function acceptValues(deps: Deps, ctx: CallContext, row: ProposalRow, a: z.output<typeof proposalAcceptSchema>): Promise<Result<ProposalAcceptResult>> {
  const target = row.kind === 'update' ? loadAnimal(deps.db, row.animalId!) : null;
  if (row.kind === 'update' && !target) return notFound('animal', row.animalId!);
  if (target) {
    const stale = staleVersion(a.expectedVersion, target.updatedAt);
    if (stale) return stale;
  }
  const proposed = row.values ?? {};
  const fields = proposedFields(proposed);
  const conflicts = target ? conflictKeys(row.baseline, target) : [];

  // Was der Prüfer übergibt, muss im Vorschlag stehen (Änderung); bei neuem Hund alle Felder der Maske.
  if (row.kind === 'update') {
    for (const k of Object.keys(a.fields ?? {})) if (!fields.includes(k as ProposalField)) return invalid([{ path: `fields.${k}`, message: 'notProposed' }]);
    for (const k of Object.keys(a.values ?? {})) if (k !== 'adoptedYear' && !fields.includes(k as ProposalField)) return invalid([{ path: `values.${k}`, message: 'notProposed' }]);
  }
  let edited: Record<string, unknown> = {};
  if (a.values && row.kind === 'update') {
    const checked = updateValuesSchema.safeParse(a.values);
    if (!checked.success) return invalid(checked.error.issues.map((i) => ({ path: ['values', ...i.path].join('.'), message: i.message })));
    edited = checked.data as Record<string, unknown>;
  } else if (a.values) {
    edited = a.values;
  }

  const keptForConflict: string[] = [];
  const finalValues: Record<string, unknown> = {};
  for (const f of fields) {
    const explicit = a.fields?.[f];
    const choice = explicit ?? (conflicts.includes(f) ? 'current' : 'proposal');
    if (f in edited) finalValues[f] = edited[f];
    else if (choice === 'proposal') finalValues[f] = proposed[f];
    else {
      if (target) finalValues[f] = fieldValueOf(target, f);
      if (conflicts.includes(f) && explicit === undefined) keptForConflict.push(f);
    }
  }
  let createValues: (AnimalCreateValues & { status?: AnimalStatus; adoptedYear?: number }) | null = null;
  if (row.kind === 'create') {
    for (const k of Object.keys(edited)) if (!(k in finalValues)) finalValues[k] = edited[k];
    const checked = createValuesSchema.safeParse(finalValues);
    if (!checked.success) return invalid(checked.error.issues.map((i) => ({ path: ['values', ...i.path].join('.'), message: i.message })));
    createValues = checked.data;
  }
  let changed = fields.some((f) => !(f in finalValues) || !sameValue(finalValues[f], proposed[f])) || Object.keys(edited).some((k) => k !== 'adoptedYear' && !sameValue(edited[k], proposed[k]));

  const currentStatus: AnimalStatus = target?.status ?? 'lookingForHome';
  const finalStatus = ('status' in finalValues ? finalValues.status : currentStatus) as AnimalStatus;
  // Das Jahr darf als eigenes Feld oder unter `values` kommen (Maske und MCP); das eigene Feld gewinnt, dann der Prüfer, dann der Vorschlag.
  const yearOf = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const adoptedYear = a.adoptedYear ?? yearOf(edited.adoptedYear) ?? yearOf(proposed.adoptedYear);
  if (finalStatus === 'adopted' && finalStatus !== currentStatus && adoptedYear === undefined) return invalid([{ path: 'adoptedYear', message: 'required' }]);

  // Fotos nur, wenn der Vorschlag welche nennt (Bildzeilen oder eine Fotoliste im Stand beim Vorschlag) oder der Prüfer eine Liste übergibt.
  const images = deps.db.select().from(animalProposalImages).where(eq(animalProposalImages.proposalId, row.id)).orderBy(asc(animalProposalImages.position)).all();
  const photoPlan = images.length > 0 || (row.baseline !== null && 'photos' in row.baseline) || a.photos !== undefined;
  const rows = photoPlan ? photoRows(row.sourceUserId, images, target?.photos ?? null) : null;
  let chosen: PhotoChoice[] = [];
  const imageById = new Map<string, ProposalImageRow>(images.map((i) => [i.id, i]));
  if (rows) {
    chosen = a.photos ?? defaultPhotoChoice(rows);
    const keys = new Set(rows.map((r) => r.key));
    for (const [i, c] of chosen.entries()) {
      const usable = c.imageId ? keys.has(`image:${c.imageId}`) && imageById.get(c.imageId)?.filename != null : keys.has(`media:${c.mediaId}`);
      if (!usable) return invalid([{ path: `photos.${i}`, message: 'notAnimalPhoto' }]);
    }
    if (chosen.length > MAX_ANIMAL_PHOTOS) return localizedConflict('tooManyPhotos', 'errors.animalProposals.tooManyPhotos', { count: chosen.length, max: MAX_ANIMAL_PHOTOS });
    if (chosen.filter((c) => c.isPrimary).length > 1) return invalid([{ path: 'photos', message: 'multiplePrimary' }]);
    changed ||= photoChoiceDiffers(rows, chosen);
  }

  // Ein vorgeschlagenes Foto des Tiers kann inzwischen aus der Mediathek gelöscht sein (Vorschläge sind kein Verweis).
  for (const c of chosen) {
    if (c.mediaId && imageState(deps.db, c.mediaId) === 'missing') return notFound('mediaAsset', c.mediaId);
  }

  // Die Mediathek schreibt Datei und eigene Transaktion; scheitert die Annahme danach, bleibt ein unbenutztes Medium —
  // `deleteUnreferencedMedia` räumt es weg, sobald jemand es braucht. Nie umgekehrt: eine Annahme ohne Bild.
  const assetOf = new Map<string, string>();
  const animalName = (finalValues.name as string | undefined) ?? target?.name ?? 'foto';
  const folder = readSetting<string>(deps, PROPOSAL_PHOTO_FOLDER_KEY) || null;
  for (const [i, c] of chosen.entries()) {
    if (!c.imageId) continue;
    const image = imageById.get(c.imageId)!;
    const bytes = await deps.files('animals').read(image.filename!);
    const stored = await storeMediaInternal(deps, ctx, { originalName: `${animalName}-${i + 1}.${EXT[image.mimeType ?? ''] ?? 'jpg'}`, bytes, folder });
    if (!stored.ok) return stored;
    assetOf.set(c.imageId, stored.value.id);
  }

  const finalFields: ProposalField[] = createValues ? PROPOSAL_FIELDS.filter((f) => f in finalValues) : fields;
  const state: ProposalState = changed ? 'acceptedWithChanges' : 'accepted';
  const files: string[] = [];
  const outcome = deps.db.transaction((tx): Result<ProposalRow> => {
    // Zwischen der Prüfung oben und hier lag das Ablegen der Bilder (await): Wer inzwischen entschieden, zurückgezogen
    // oder das Tier geändert hat, gewinnt — die schon abgelegten Medien bleiben unbenutzt (siehe oben).
    const fresh = loadProposal(tx, row.id);
    if (!fresh || fresh.state !== 'open') return localizedConflict('proposalNotOpen', 'errors.animalProposals.proposalNotOpen', { state: fresh?.state ?? 'withdrawn' });
    if (target) {
      const stale = staleVersion(target.updatedAt, loadAnimal(tx, target.id)?.updatedAt ?? '');
      if (stale) return stale;
    }
    const now = isoNow(deps.clock);
    let current: AnimalRecord;
    if (createValues) {
      const { status: _status, adoptedYear: _year, ...values } = createValues;
      current = insertAnimalTx(tx, deps, ctx, values);
    } else {
      current = target!;
      const changes = Object.fromEntries(Object.entries(finalValues).filter(([f, v]) => f !== 'status' && !sameValue(v, fieldValueOf(current, f as ProposalField)))) as AnimalChanges;
      if (Object.keys(changes).length > 0) current = updateAnimalTx(tx, deps, ctx, current, changes);
    }
    if (finalStatus !== current.status) current = setStatusTx(tx, deps, ctx, current, finalStatus, adoptedYear);
    if (rows) {
      const writes = photoWrites(chosen, current, imageById, assetOf, row);
      if (!samePhotos(current, writes)) current = replacePhotosTx(tx, deps, ctx, current, writes);
    }
    if (createValues && a.publish) current = setPublishedTx(tx, deps, ctx, current, true);
    if (row.externalRef) upsertOrigin(tx, deps, { animalId: current.id, sourceUserId: row.sourceUserId, externalRef: row.externalRef, externalUrl: row.externalUrl });
    for (const [imageId, assetId] of assetOf) tx.update(animalProposalImages).set({ mediaId: assetId }).where(eq(animalProposalImages.id, imageId)).run();
    files.push(...releaseImages(tx, row.id));
    const after = loadAnimal(tx, current.id)!;
    const final: ProposalFinal = {
      animalId: after.id,
      // Bei neuem Hund auch, was der Prüfer über den Vorschlag hinaus gesetzt hat: Die Endfassung ist der Stand am Tier (A28).
      values: Object.fromEntries(finalFields.map((f) => [f, fieldValueOf(after, f)])),
      photos: rows ? after.photos.map((p) => ({ mediaId: p.assetId, sourceRef: p.sourceUserId === row.sourceUserId ? p.sourceRef : null, position: p.sortOrder, isPrimary: p.isPrimary, crop: p.crop })) : null,
      isPublished: after.isPublished,
    };
    tx.update(animalProposals).set({ state, final, animalId: after.id, decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
    const entry = proposalAudit(row, after.name, state);
    if (state === 'acceptedWithChanges') recordAudit(tx, deps, ctx, { action: 'animals.proposal.acceptWithChanges', entityType: 'animalProposal', ...entry });
    else recordAudit(tx, deps, ctx, { action: 'animals.proposal.accept', entityType: 'animalProposal', ...entry });
    return ok(loadProposal(tx, row.id)!);
  });
  if (!outcome.ok) return outcome;
  const updated = outcome.value;
  await deleteProposalFiles(deps, files);
  return ok({ proposal: statusItemOf(updated), animalId: updated.animalId, keptForConflict });
}

/**
 * Die gewählte Fotoliste als Schreibauftrag. Zwei Wahlen mit demselben Medium (gleiche Bytes) werden eins, an der
 * Stelle der ersten; Titelbild ist es, wenn eine der beiden es ist. Trifft ein neues Bild per Bytes ein Foto, das das
 * Tier schon aus Kompass oder von einer anderen Quelle hat, bleibt dessen Herkunft und Ausschnitt — gleiche Bytes
 * sind kein Rückkanal, nur ein ausdrücklich genanntes Foto (`mediaId` mit Referenz) wird Foto der Quelle.
 */
function photoWrites(chosen: readonly PhotoChoice[], current: AnimalRecord, imageById: ReadonlyMap<string, ProposalImageRow>, assetOf: ReadonlyMap<string, string>, row: ProposalRow): PhotoWrite[] {
  const writes: PhotoWrite[] = [];
  const byAsset = new Map<string, PhotoWrite>();
  const merged = (assetId: string, isPrimary: boolean): boolean => {
    const earlier = byAsset.get(assetId);
    if (!earlier) return false;
    earlier.isPrimary ||= isPrimary;
    return true;
  };
  const push = (w: PhotoWrite) => {
    byAsset.set(w.assetId, w);
    writes.push(w);
  };
  for (const c of chosen) {
    if (c.imageId) {
      const image = imageById.get(c.imageId)!;
      const assetId = assetOf.get(c.imageId)!;
      if (merged(assetId, c.isPrimary)) continue;
      const existing = current.photos.find((p) => p.assetId === assetId);
      if (existing && existing.sourceUserId !== row.sourceUserId) {
        push({ assetId, isPrimary: c.isPrimary, crop: c.crop === undefined ? (image.crop ?? undefined) : c.crop });
        continue;
      }
      push({ assetId, isPrimary: c.isPrimary, crop: c.crop === undefined ? (image.crop ?? null) : c.crop, source: { userId: row.sourceUserId, ref: image.sourceRef } });
    } else {
      const assetId = c.mediaId!;
      if (merged(assetId, c.isPrimary)) continue;
      const entry = [...imageById.values()].find((i) => i.mediaId === assetId && i.filename === null);
      const photo = current.photos.find((p) => p.assetId === assetId);
      // Nennt die Quelle ein Foto aus Kompass mit ihrer Referenz, wird es ihr Foto (Rückkanal); sonst bleibt die Herkunft.
      const source = entry?.sourceRef && photo && photo.sourceUserId === null ? { userId: row.sourceUserId, ref: entry.sourceRef } : undefined;
      push({ assetId, isPrimary: c.isPrimary, crop: c.crop, source });
    }
  }
  return writes;
}

/** Ändert der Schreibauftrag nichts an der Fotoliste? Dann kein Eintrag `animals.setPhotos`. */
function samePhotos(current: AnimalRecord, writes: readonly PhotoWrite[]): boolean {
  if (writes.length !== current.photos.length) return false;
  const anyPrimary = writes.some((w) => w.isPrimary);
  return writes.every((w, i) => {
    const p = current.photos[i]!;
    const crop: PhotoCrop | null = w.crop === undefined ? p.crop : w.crop === null ? null : roundCrop(w.crop);
    const userId = w.source === undefined ? p.sourceUserId : (w.source?.userId ?? null);
    const ref = w.source === undefined ? p.sourceRef : (w.source?.ref ?? null);
    const primary = w.isPrimary || (i === 0 && !anyPrimary);
    return p.assetId === w.assetId && p.isPrimary === primary && sameValue(p.crop, crop) && p.sourceUserId === userId && p.sourceRef === ref;
  });
}

export const proposalRejectSchema = z.object({ id: z.string().min(1), note: z.string().trim().max(500).optional() }).strict();

/** Ablehnen (Spec § 3): Grund optional, geht an die Quelle zurück; die Zwischenablage wird sofort geleert. */
export async function rejectProposal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProposalStatusItem>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, proposalRejectSchema, input);
  if (!parsed.ok) return parsed;
  const found = openProposal(deps, parsed.value.id);
  if (!found.ok) return found;
  const row = found.value;
  const files: string[] = [];
  const updated = deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(animalProposals).set({ state: 'rejected', decisionNote: parsed.value.note || null, decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
    files.push(...releaseImages(tx, row.id));
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.reject', entityType: 'animalProposal', ...proposalAudit(row, nameOf(tx, row), 'rejected') });
    return loadProposal(tx, row.id)!;
  });
  await deleteProposalFiles(deps, files);
  return ok(statusItemOf(updated));
}

export const proposalResolveDelistedSchema = z.object({ id: z.string().min(1), adoptedYear: z.number().int().min(2000).max(2100).optional(), expectedVersion: expectedVersionField }).strict();

/** „Vermittelt · offline · erledigt“ (Spec § 6): Status vermittelt, von der Webseite, Hinweis zur Kenntnis — schon Erledigtes fällt heraus. */
export async function resolveDelistedNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ proposal: ProposalStatusItem; steps: ('status' | 'unpublish')[] }>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(deps, proposalResolveDelistedSchema, input);
  if (!parsed.ok) return parsed;
  const found = openProposal(deps, parsed.value.id);
  if (!found.ok) return found;
  const row = found.value;
  if (row.kind !== 'notice' || row.noticeKind !== 'delisted') return localizedConflict('notDelisted', 'errors.animalProposals.notDelisted');
  const target = loadAnimal(deps.db, row.animalId!);
  if (!target) return notFound('animal', row.animalId!);
  const stale = staleVersion(parsed.value.expectedVersion, target.updatedAt);
  if (stale) return stale;
  const steps: ('status' | 'unpublish')[] = [];
  const updated = deps.db.transaction((tx) => {
    let current = target;
    if (current.status !== 'adopted') {
      current = setStatusTx(tx, deps, ctx, current, 'adopted', parsed.value.adoptedYear ?? Number(todayIn(deps).slice(0, 4)));
      steps.push('status');
    }
    if (current.isPublished) {
      current = setPublishedTx(tx, deps, ctx, current, false);
      steps.push('unpublish');
    }
    const now = isoNow(deps.clock);
    tx.update(animalProposals).set({ state: 'accepted', decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.accept', entityType: 'animalProposal', ...proposalAudit(row, current.name, 'accepted') });
    return loadProposal(tx, row.id)!;
  });
  return ok({ proposal: statusItemOf(updated), steps });
}

/** Dateien entschiedener Vorschläge, die noch in der Zwischenablage liegen (Nachlese nach einem Absturz zwischen Commit und Löschen). */
export async function deleteDecidedProposalFiles(deps: Deps): Promise<number> {
  const decided = deps.db.select({ id: animalProposals.id }).from(animalProposals).where(ne(animalProposals.state, 'open'));
  const rows = deps.db
    .select({ id: animalProposalImages.id, filename: animalProposalImages.filename })
    .from(animalProposalImages)
    .where(and(isNotNull(animalProposalImages.filename), inArray(animalProposalImages.proposalId, decided)))
    .all();
  if (rows.length === 0) return 0;
  await deleteProposalFiles(deps, rows.map((r) => r.filename!));
  deps.db.transaction((tx: DbOrTx) => {
    tx.update(animalProposalImages).set({ filename: null }).where(inArray(animalProposalImages.id, rows.map((r) => r.id))).run();
  });
  return rows.length;
}
