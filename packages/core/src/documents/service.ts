import { eq } from 'drizzle-orm';
import { renderMarkdownTypst } from '@kompass/markdown';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';
import type { DocumentBuildResult, DocumentImage, DocumentRenderContext, DocumentSlots, DocumentTemplate } from '../modules/manifest';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { readAllSettings, readSetting } from '../settings/service';
import { resolveActiveTheme } from '../themes/service';
import { validate } from '../validate';
import { DOCUMENT_IMAGE_KEY, documentImageExtension } from './images';

const renderSchema = z.object({
  templateKey: z.string().min(1),
  input: z.unknown(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
});

/**
 * Baut den Rendering-Kontext für eine Vorlage. `number` ist leer für einen
 * Ad-hoc-Auszug. `issuedOn` ist das Datum **auf** dem Dokument (ISO-Datum),
 * wenn der Aufrufer eines führt — die Akte druckt es statt des Tages, an dem
 * jemand auf „Festschreiben“ drückt. Fehlt es, gilt die Uhr.
 */
export async function buildContext(deps: Deps, ctx: CallContext, number: string, issuedOn?: string): Promise<DocumentRenderContext> {
  const all = readAllSettings(deps);
  const organization = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('organization.')));
  const logoId = readSetting<string | null>(deps, 'branding.logoAssetId');
  let logo: DocumentRenderContext['logo'] = null;
  if (logoId) {
    const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, logoId)).get();
    if (asset) logo = { bytes: await deps.media.read(asset.filename), mimeType: asset.mimeType };
  }
  const issuedAt = issuedOn ? `${issuedOn}T12:00:00.000Z` : isoNow(deps.clock);
  return { number, issuedAt, organization, theme: resolveActiveTheme(deps), logo };
}

/** Der Snapshot eines ausgestellten Dokuments — `input ∪ { slots, base, baseChecksum, images }`, je Bild nur die Prüfsumme. */
export interface DocumentSnapshot {
  input: unknown;
  slots: DocumentSlots;
  base: string;
  baseChecksum: string;
  images?: Record<string, string>;
}

/** Bytes gehören nie in den Snapshot: ein `Uint8Array` in der Eingabe fällt heraus, seine Prüfsumme daneben bleibt. */
function withoutBytes(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null, (_key, v: unknown) => (v instanceof Uint8Array ? undefined : v)));
}

/**
 * Baut den Snapshot aus dem Ergebnis von `prepare`. `input` ist, was der
 * Aufrufer ablegen will (Vorarbeiten-Spec § 4 Regel 7) — sonst die geprüften
 * Daten der Vorlage, ohne Bytes.
 */
export function documentSnapshot(
  prepared: { data: unknown; built: DocumentBuildResult; baseId: string; base: { checksum: string } },
  input?: unknown,
): DocumentSnapshot {
  const snapshot: DocumentSnapshot = { input: withoutBytes(input ?? prepared.data), slots: prepared.built.slots, base: prepared.baseId, baseChecksum: prepared.base.checksum };
  const images = prepared.built.images;
  if (images && Object.keys(images).length > 0) {
    snapshot.images = Object.fromEntries(Object.entries(images).map(([key, image]) => [key, image.checksum]));
  }
  return snapshot;
}

/** Vorgabe der Vorlage, überschrieben von `build()` und von `documents.bases`. */
function resolveBaseId(deps: Deps, template: DocumentTemplate, fromBuild: string | undefined): string {
  const configured = readSetting<Record<string, string>>(deps, 'documents.bases')[template.key];
  return configured ?? fromBuild ?? template.base;
}

/** Vorlage auflösen, Rechte und Eingabe prüfen, Körper und Basis bestimmen — gemeinsam für Akteneintrag und Auszug. */
export async function prepare(
  deps: Deps,
  ctx: CallContext,
  parsedInput: z.infer<typeof renderSchema>,
  render?: { number: string; issuedOn?: string },
): Promise<Result<{ template: DocumentTemplate; data: unknown; built: DocumentBuildResult; baseId: string; base: { checksum: string }; bodyTypst: string; images: Record<string, DocumentImage> | undefined }>> {
  const template = deps.registry.documentTemplates.get(parsedInput.templateKey) as DocumentTemplate | undefined;
  if (!template) return notFound('documentTemplate', parsedInput.templateKey);
  if (template.permission) {
    const extra = requirePermission(ctx, template.permission);
    if (extra) return extra;
  }
  const data = validate(deps, template.schema, parsedInput.input);
  if (!data.ok) return data;

  // Ohne `render` ist es die Vorprüfung oder ein Brief: Die Basis zeichnet die
  // Nummer. Ein Modul, dessen Körper die Nummer druckt, ruft je Anlauf der
  // Nummernschleife mit der angesehenen Nummer.
  const built = template.build(data.value, await buildContext(deps, ctx, render?.number ?? 'PENDING', render?.issuedOn));
  const baseId = resolveBaseId(deps, template, built.base);
  const base = deps.documents.base(baseId);
  if (!base) return conflict('documentBaseUnavailable', `Basis-Vorlage „${baseId}“ ist nicht verfügbar`);

  for (const [key, image] of Object.entries(built.images ?? {})) {
    if (!DOCUMENT_IMAGE_KEY.test(key) || documentImageExtension(image.bytes) === null) {
      return conflict('documentImageInvalid', `Bild „${key}“ der Vorlage ${template.key} ist kein PNG oder JPEG unter einem gültigen Schlüssel`);
    }
  }

  const bodyTypst = 'markdown' in built.body ? await renderMarkdownTypst(built.body.markdown) : built.body.typst;
  return ok({ template, data: data.value, built, baseId, base, bodyTypst, images: built.images });
}

/**
 * Ein Ad-hoc-Auszug: rendern und zurückgeben. Keine Nummer, keine Zeile in
 * der Akte, keine Ablage in der Mediathek — nur ein Eintrag im
 * Änderungsprotokoll, denn der Vorgang ist das Ziehen, nicht die Datei.
 * Die Akte selbst — Ablage, Nummernvergabe, Storno — lebt im Modul `dms`.
 */
export async function exportDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
  const denied = requirePermission(ctx, 'documents.export');
  if (denied) return denied;
  const parsed = validate(deps, renderSchema, input);
  if (!parsed.ok) return parsed;
  const prepared = await prepare(deps, ctx, parsed.value);
  if (!prepared.ok) return prepared;
  const { template, built, baseId, bodyTypst, images } = prepared.value;
  if (template.filed !== false) {
    return conflict('documentIsFiled', `Vorlage „${template.key}“ ist ein Akteneintrag und wird über das Modul dms erzeugt`);
  }

  const context = await buildContext(deps, ctx, '');
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context, images });
  const filename = `${(built.slots.title ?? template.key).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || template.key}.pdf`;
  deps.db.transaction((tx: DbOrTx) => {
    recordAudit(tx, deps, ctx, {
      action: 'documents.export',
      entityType: 'documentTemplate',
      entityId: template.key,
      after: { templateKey: template.key, base: baseId },
      summary: `Auszug „${built.slots.title ?? template.key}“ aus Vorlage ${template.key} gezogen`,
    });
  });
  return ok({ bytes, filename, mimeType: 'application/pdf' });
}

export async function listDocumentBases(
  deps: Deps,
  ctx: CallContext,
): Promise<Result<{ id: string; label: string; kind: string; ok: boolean; error?: string }[]>> {
  const denied = requirePermission(ctx, 'documents.export');
  if (denied) return denied;
  const out = [];
  for (const base of deps.documents.bases()) {
    const probe = await deps.documents.probe(base.id);
    out.push({ id: base.id, label: base.label, kind: base.kind, ok: probe.ok, error: probe.ok ? undefined : probe.error });
  }
  return ok(out.sort((a, b) => a.id.localeCompare(b.id)));
}
