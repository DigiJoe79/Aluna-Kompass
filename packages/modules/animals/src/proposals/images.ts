import {
  inspectRasterImage,
  invalid,
  MEDIA_MAX_BYTES,
  newId,
  notFound,
  ok,
  recordAudit,
  renderPreview,
  requirePermission,
  validate,
  type CallContext,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { animalProposalImages } from '../schema';
import { proposalGate } from './gate';

/** Bereitgestellte Bilder ohne Vorschlag verschwinden nach 24 Stunden (Spec Vorschlags-Eingang § 5, § 7). */
export const STAGED_IMAGE_TTL_MS = 24 * 3_600_000;

export const proposalImageStageSchema = z.object({
  originalName: z.string().min(1).max(200),
  bytes: z.instanceof(Uint8Array),
  sourceRef: z.string().trim().min(1).max(200).optional(),
});

export interface StagedImage {
  imageId: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  expiresAt: string;
}

/** Dateiname in der Ablage des Moduls: Kennung klein, Endung nach Inhalt. */
export const stagedFileName = (imageId: string, ext: string): string => `p-${imageId.toLowerCase()}.${ext}`;

/**
 * Ein Bild für einen Vorschlag in die Zwischenablage legen (Spec § 7): Ablage des Moduls, nicht die Mediathek.
 * Geprüft werden Typ nach Inhalt, Größe und Lesbarkeit. Das Protokoll nennt nur die Tatsache, keinen Inhalt.
 */
export async function stageProposalImage(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<StagedImage>> {
  const gate = proposalGate(deps, ctx);
  if (gate) return gate;
  const parsed = validate(deps, proposalImageStageSchema, input);
  if (!parsed.ok) return parsed;
  const { bytes, sourceRef } = parsed.value;
  if (bytes.byteLength > MEDIA_MAX_BYTES) return invalid([{ path: 'bytes', message: 'fileTooLarge' }]);
  const image = await inspectRasterImage(bytes);
  if (!image) return invalid([{ path: 'bytes', message: 'unsupportedMediaType' }]);
  const id = newId();
  const filename = stagedFileName(id, image.ext);
  // Erst die Datei, dann die Zeile: eine Zeile ohne Datei gibt es nie (eine Datei ohne Zeile räumt niemand — sie ist klein und selten).
  await deps.files('animals').write(filename, bytes);
  const now = deps.clock.now();
  deps.db.transaction((tx) => {
    tx.insert(animalProposalImages)
      .values({ id, sourceUserId: ctx.userId!, proposalId: null, filename, mimeType: image.mimeType, bytes: image.bytes, width: image.width, height: image.height, checksum: image.checksum, sourceRef: sourceRef ?? null, createdAt: now.toISOString() })
      .run();
    recordAudit(tx, deps, ctx, { action: 'animals.proposal.stageImage', entityType: 'animalProposalImage', entityId: id });
  });
  return ok({ imageId: id, mimeType: image.mimeType, width: image.width, height: image.height, bytes: image.bytes, expiresAt: new Date(now.getTime() + STAGED_IMAGE_TTL_MS).toISOString() });
}

/** Bytes für die Prüfung (Route Handler in Plan B), nur `animals.manage`; `preview` = WebP-Vorschau wie die Mediathek. */
export async function readProposalImage(deps: Deps, ctx: CallContext, input: { imageId: string; variant?: 'original' | 'preview' }): Promise<Result<{ bytes: Uint8Array; contentType: string }>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const row = deps.db.select().from(animalProposalImages).where(eq(animalProposalImages.id, input.imageId)).get();
  if (!row?.filename) return notFound('animalProposalImage', input.imageId);
  const bytes = await deps.files('animals').read(row.filename);
  if (input.variant === 'preview') return ok({ bytes: await renderPreview(bytes), contentType: 'image/webp' });
  return ok({ bytes, contentType: row.mimeType ?? 'application/octet-stream' });
}

/** Dateien der Zwischenablage löschen; idempotent. */
export async function deleteProposalFiles(deps: Deps, filenames: readonly string[]): Promise<void> {
  for (const name of filenames) await deps.files('animals').delete(name);
}
