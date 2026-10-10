import { invalid, isoNow, localizedConflict, newId, notFound, ok, recordAudit, requirePermission, unauthorized, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { animalOrigins, animalProposalImages, animalProposals, PROPOSAL_STATES, type ProposalFinal, type ProposalKind, type ProposalState } from '../schema';
import { loadAnimal, roundCrop, type AnimalRecord } from '../service';
import { proposalGate } from './gate';
import { proposalAudit, releaseImages } from './audit';
import { deleteProposalFiles } from './images';
import { baselineOf, proposalName, proposalRuleIssues, proposalSubmitUnion, proposedFields, type BaselineKey, type ProposalRow } from './model';

/** Was die Quelle über ihren Vorschlag zurückliest (Rückkanal, Spec § 5). Wer entschieden hat, steht nur im Protokoll (A30). */
export interface ProposalStatusItem {
  id: string;
  sourceKey: string;
  kind: ProposalKind;
  state: ProposalState;
  animalId: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decisionReason: 'animalDeleted' | null;
  sameAsAnswer: 'same' | 'different' | null;
  final: ProposalFinal | null;
  cleared: boolean;
}

export function statusItemOf(row: ProposalRow): ProposalStatusItem {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    kind: row.kind,
    state: row.state,
    animalId: row.animalId,
    externalRef: row.externalRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    decisionReason: row.decisionReason,
    sameAsAnswer: row.sameAsAnswer,
    final: row.final ?? null,
    cleared: row.clearedAt !== null,
  };
}

export function loadProposal(db: DbOrTx, id: string): ProposalRow | null {
  return db.select().from(animalProposals).where(eq(animalProposals.id, id)).get() ?? null;
}

/** Name eines Vorschlags für Protokoll und Liste: das Tier heute, sonst der vorgeschlagene Name. */
export function nameOf(db: DbOrTx, p: Pick<ProposalRow, 'kind' | 'values' | 'animalId'>): string {
  const animal = p.animalId ? loadAnimal(db, p.animalId) : null;
  return proposalName(p, animal);
}

/**
 * Einen Vorschlag anlegen oder ersetzen (Spec § 3). Ein schon vergebener `sourceKey` liefert den vorhandenen
 * Vorschlag (A15). Eine neue Änderung derselben Quelle zum selben Tier ersetzt die offene (A14), ein neuer Hund mit
 * derselben `externalRef` den offenen neuen Hund; Bilder des alten, die der neue nicht nennt, verschwinden.
 */
export async function submitProposal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ proposal: ProposalStatusItem; existing: boolean; replaced: string[] }>> {
  const gate = proposalGate(deps, ctx);
  if (gate) return gate;
  const parsed = validate(deps, proposalSubmitUnion, input);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  const rules = proposalRuleIssues({ hints: 'hints' in p ? p.hints : undefined, photos: 'photos' in p ? p.photos : undefined });
  if (rules.length) return invalid(rules);
  const sourceUserId = ctx.userId!;

  const known = deps.db.select().from(animalProposals).where(and(eq(animalProposals.sourceUserId, sourceUserId), eq(animalProposals.sourceKey, p.sourceKey))).get();
  if (known) return ok({ proposal: statusItemOf(known), existing: true, replaced: [] });

  let target: AnimalRecord | null = null;
  if (p.kind !== 'create') {
    target = loadAnimal(deps.db, p.animalId);
    if (!target) return notFound('animal', p.animalId);
  }
  const values = p.kind === 'notice' ? null : (p.values as Record<string, unknown>);
  const photos = p.kind === 'notice' ? undefined : p.photos;
  if (p.kind === 'update' && Object.keys(values ?? {}).length === 0 && photos === undefined) return invalid([{ path: 'values', message: 'emptyProposal' }]);
  if (p.kind === 'create') {
    const origin = deps.db.select({ animalId: animalOrigins.animalId }).from(animalOrigins).where(and(eq(animalOrigins.sourceUserId, sourceUserId), eq(animalOrigins.externalRef, p.externalRef))).get();
    if (origin) return localizedConflict('originExists', 'errors.animalProposals.originExists', { animalId: origin.animalId });
  }

  // Wen dieser Aufruf ersetzt — vorher bestimmt, weil ein Bild des ersetzten Vorschlags weiterverwendet werden darf.
  const toReplace =
    p.kind === 'update'
      ? deps.db.select().from(animalProposals).where(and(eq(animalProposals.sourceUserId, sourceUserId), eq(animalProposals.animalId, p.animalId), eq(animalProposals.state, 'open'), eq(animalProposals.kind, 'update'))).all()
      : p.kind === 'create'
        ? deps.db.select().from(animalProposals).where(and(eq(animalProposals.sourceUserId, sourceUserId), eq(animalProposals.externalRef, p.externalRef), eq(animalProposals.state, 'open'), eq(animalProposals.kind, 'create'))).all()
        : [];
  const replacedIds = new Set(toReplace.map((r) => r.id));

  if (photos) {
    if (photos.filter((ph) => ph.isPrimary).length > 1) return invalid([{ path: 'photos', message: 'multiplePrimary' }]);
    for (const [i, ph] of photos.entries()) {
      if (ph.imageId !== undefined) {
        const row = deps.db.select().from(animalProposalImages).where(eq(animalProposalImages.id, ph.imageId)).get();
        const usable = row && row.sourceUserId === sourceUserId && row.filename !== null && (row.proposalId === null || replacedIds.has(row.proposalId));
        if (!usable) return localizedConflict('proposalImageUnavailable', 'errors.animalProposals.proposalImageUnavailable', { imageId: ph.imageId });
      } else if (p.kind === 'create') {
        return invalid([{ path: `photos.${i}.mediaId`, message: 'mediaNotAllowed' }]);
      } else if (!target!.photos.some((x) => x.assetId === ph.mediaId)) {
        return invalid([{ path: `photos.${i}.mediaId`, message: 'notAnimalPhoto' }]);
      }
    }
  }

  const reusedImageIds = new Set((photos ?? []).flatMap((ph) => (ph.imageId ? [ph.imageId] : [])));
  const orphaned: string[] = [];
  const result = deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    for (const old of toReplace) {
      tx.update(animalProposals).set({ state: 'replaced', decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, old.id)).run();
      recordAudit(tx, deps, ctx, { action: 'animals.proposal.replace', entityType: 'animalProposal', ...proposalAudit(old, proposalName(old, target), 'replaced') });
      for (const img of tx.select().from(animalProposalImages).where(eq(animalProposalImages.proposalId, old.id)).all()) {
        if (img.filename === null || reusedImageIds.has(img.id)) continue;
        orphaned.push(img.filename);
        tx.update(animalProposalImages).set({ filename: null }).where(eq(animalProposalImages.id, img.id)).run();
      }
    }
    const id = newId();
    const baselineKeys: BaselineKey[] = p.kind === 'update' ? [...proposedFields(values), ...(photos ? (['photos'] as const) : [])] : [];
    tx.insert(animalProposals)
      .values({
        id,
        sourceUserId,
        sourceKey: p.sourceKey,
        kind: p.kind,
        animalId: target?.id ?? null,
        externalRef: p.externalRef ?? null,
        externalUrl: p.externalUrl ?? null,
        trailUrl: p.trailUrl ?? null,
        values,
        hints: p.kind === 'create' || p.kind === 'update' ? p.hints : null,
        baseline: p.kind === 'update' ? baselineOf(target!, baselineKeys) : null,
        reason: p.kind === 'notice' || p.kind === 'sameAs' ? p.reason : null,
        noticeKind: p.kind === 'notice' ? (p.noticeKind ?? null) : null,
        state: 'open',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const [i, ph] of (photos ?? []).entries()) {
      const crop = ph.crop ? roundCrop(ph.crop) : null;
      if (ph.imageId !== undefined) {
        const row = tx.select({ sourceRef: animalProposalImages.sourceRef }).from(animalProposalImages).where(eq(animalProposalImages.id, ph.imageId)).get()!;
        tx.update(animalProposalImages).set({ proposalId: id, position: i, isPrimary: ph.isPrimary, crop, sourceRef: ph.sourceRef ?? row.sourceRef }).where(eq(animalProposalImages.id, ph.imageId)).run();
      } else {
        tx.insert(animalProposalImages).values({ id: newId(), sourceUserId, proposalId: id, filename: null, mediaId: ph.mediaId!, position: i, isPrimary: ph.isPrimary, crop, sourceRef: ph.sourceRef ?? null, createdAt: now }).run();
      }
    }
    const row = loadProposal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.submit', entityType: 'animalProposal', ...proposalAudit(row, proposalName(row, target), 'open', null) });
    return row;
  });
  await deleteProposalFiles(deps, orphaned);
  return ok({ proposal: statusItemOf(result), existing: false, replaced: toReplace.map((r) => r.sourceKey) });
}

export const proposalWithdrawSchema = z.object({ sourceKey: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(500) }).strict();

/** Die Quelle zieht ihren offenen Vorschlag zurück. Ohne Einstellungs-Gate: Ausschalten lässt nichts unbemerkt verschwinden (Spec § 4). */
export async function withdrawProposal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProposalStatusItem>> {
  const denied = requirePermission(ctx, 'animals.propose');
  if (denied) return denied;
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(deps, proposalWithdrawSchema, input);
  if (!parsed.ok) return parsed;
  const { sourceKey, reason } = parsed.value;
  const row = deps.db.select().from(animalProposals).where(and(eq(animalProposals.sourceUserId, ctx.userId), eq(animalProposals.sourceKey, sourceKey))).get();
  if (!row) return notFound('animalProposal', sourceKey);
  if (row.state !== 'open') return localizedConflict('proposalNotOpen', 'errors.animalProposals.proposalNotOpen', { state: row.state });
  const files: string[] = [];
  const updated = deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(animalProposals).set({ state: 'withdrawn', decisionNote: reason, decidedAt: now, updatedAt: now }).where(eq(animalProposals.id, row.id)).run();
    files.push(...releaseImages(tx, row.id));
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.withdraw', entityType: 'animalProposal', ...proposalAudit(row, nameOf(tx, row), 'withdrawn') });
    return loadProposal(tx, row.id)!;
  });
  await deleteProposalFiles(deps, files);
  return ok(statusItemOf(updated));
}

export const proposalsStatusSchema = z
  .object({
    sourceKeys: z.array(z.string().min(1).max(200)).max(200).optional(),
    since: z.iso.datetime().optional(),
    state: z.enum(PROPOSAL_STATES).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

/** Rückkanal der Quelle: nur die eigenen Vorschläge, älteste Änderung zuerst. */
export async function proposalsStatus(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<{ proposals: ProposalStatusItem[] }>> {
  const denied = requirePermission(ctx, 'animals.propose');
  if (denied) return denied;
  if (!ctx.userId) return unauthorized('invalidCredentials');
  const parsed = validate(deps, proposalsStatusSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { sourceKeys, since, state, limit } = parsed.value;
  if (sourceKeys && sourceKeys.length === 0) return ok({ proposals: [] });
  const rows = deps.db
    .select()
    .from(animalProposals)
    .where(
      and(
        eq(animalProposals.sourceUserId, ctx.userId),
        sourceKeys ? inArray(animalProposals.sourceKey, sourceKeys) : undefined,
        since ? gte(animalProposals.updatedAt, since) : undefined,
        state ? eq(animalProposals.state, state) : undefined,
      ),
    )
    .orderBy(asc(animalProposals.updatedAt), asc(animalProposals.id))
    .limit(limit)
    .all();
  return ok({ proposals: rows.map(statusItemOf) });
}
