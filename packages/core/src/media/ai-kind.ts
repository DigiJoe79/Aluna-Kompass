import { eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { invalid, localizedConflict, notFound, ok, type Result } from '../result';
import { zodIssues } from '../validate';
import { aiLabelingEnabled, type AiKind } from './ai-labeling';
import { parseDerivedAssetId } from './derived-id';

const setAiKindInput = z.object({
  id: z.string().min(1),
  aiKind: z.enum(['none', 'edited', 'generated']),
});

/**
 * Setzt die Bildkennzeichnung eines Mediums („keine“, „bearbeitet“, „mit KI erstellt“).
 * Ist die Kennzeichnung bereits gesetzt, geschieht nichts und es wird kein
 * Protokolleintrag geschrieben (`changed: false`).
 *
 * Ein abgeleitetes Medium (Bildausschnitt) wird auf das Ursprungsmedium
 * zurückgeführt.
 */
export async function setMediaAiKind(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ changed: boolean }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;

  const parsed = setAiKindInput.safeParse(input);
  if (!parsed.success) return invalid(zodIssues(parsed.error));

  if (!aiLabelingEnabled(deps)) {
    return localizedConflict('aiLabelingDisabled', 'errors.media.aiLabelingDisabled');
  }

  const rootId = parseDerivedAssetId(parsed.data.id)?.assetId ?? parsed.data.id;
  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, rootId)).get();
  if (!asset) return notFound('mediaAsset', rootId);

  const nextKind = parsed.data.aiKind;
  if (asset.aiKind === nextKind) return ok({ changed: false });

  deps.db.transaction((tx) => {
    tx.update(mediaAssets).set({ aiKind: nextKind }).where(eq(mediaAssets.id, asset.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.aiKind',
      entityType: 'mediaAsset',
      entityId: asset.id,
      before: { aiKind: asset.aiKind },
      after: { aiKind: nextKind },
      params: { filename: asset.filename, aiKind: nextKind },
    });
  });

  return ok({ changed: true });
}

/**
 * Löst die KI-Art eines Mediums auf. Abgeleitete IDs erben die Art ihres Ursprungs;
 * unbekannte IDs liefern `'none'`.
 */
export function aiKindOfInternal(db: DbOrTx, assetId: string): AiKind {
  const rootId = parseDerivedAssetId(assetId)?.assetId ?? assetId;
  const asset = db.select({ aiKind: mediaAssets.aiKind }).from(mediaAssets).where(eq(mediaAssets.id, rootId)).get();
  return (asset?.aiKind as AiKind) ?? 'none';
}

/**
 * Zählt Medien, die eine Bildkennzeichnung tragen (≠ `'none'`).
 * Wird beim Ausschalten der Kennzeichnung in den Einstellungen angezeigt.
 */
export function countMediaWithAiKindInternal(db: DbOrTx): number {
  return db.select({ id: mediaAssets.id }).from(mediaAssets).where(ne(mediaAssets.aiKind, 'none')).all().length;
}
