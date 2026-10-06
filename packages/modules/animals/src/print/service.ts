import { createHash } from 'node:crypto';
import { defaultLocale, ensureImageVariant, exportDocument, notFound, ok, readSetting, requirePermission, schema as core, todayIn, validate, type CallContext, type Deps, type ImageVariant, type Result } from '@kompass/core';
import { renderMarkdownTypst } from '@kompass/markdown';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { profileUrl } from '../profile-url';
import { loadAnimal, type AnimalRecord } from '../service';
import { PHOTO_FRAME_KEY, PROFILE_URL_KEY, type PhotoFrame } from '../settings';
import { qrRows } from './qr';
import { PROFILE_MAX_PAGES, PROFILE_TEMPLATE_KEY, type ProfileImage, type ProfileInput, type ProfilePage } from './template';

/** Beschriftungen der Seite. Die Route übersetzt sie, damit in der Vorlage kein Text steht (Prinzip 7). */
export const profileLabelsSchema = z.object({
  title: z.string().trim().min(1).max(80),
  sexes: z.object({ female: z.string(), male: z.string() }),
  locations: z.object({ shelter: z.string(), germany: z.string() }),
  status: z.object({ reserved: z.string(), adopted: z.string() }),
  emergency: z.string(),
  sponsorable: z.string(),
  /** Mit `{name}` als Platzhalter. */
  more: z.string(),
  continued: z.string(),
});
export type ProfileLabels = z.infer<typeof profileLabelsSchema>;

export const exportProfilesSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(PROFILE_MAX_PAGES)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicateIds' }),
  labels: profileLabelsSchema,
});

/** Die Marken unter dem Namen, in der Reihenfolge der Webseite; leere fallen weg. */
export function profileFacts(animal: AnimalRecord, locale: string, labels: ProfileLabels): string[] {
  const size = animal.sizeText[locale] || (animal.sizeCm > 0 ? `${animal.sizeCm} cm` : '');
  const where = [labels.locations[animal.location], animal.place ? `(${animal.place})` : ''].filter(Boolean).join(' ');
  return [
    labels.sexes[animal.sex],
    animal.birthText[locale] ?? '',
    size,
    where,
    animal.isEmergency ? labels.emergency : '',
    animal.status === 'lookingForHome' ? '' : labels.status[animal.status],
    animal.isSponsorable ? labels.sponsorable : '',
  ].filter((fact) => fact.trim() !== '');
}

/** Der Langtext als Liste von Absätzen in Typst — die Vorlage kürzt nach ganzen Absätzen (Spec § 8). */
export async function bodyParagraphs(markdown: string): Promise<string[]> {
  const parts = markdown.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return Promise.all(parts.map((part) => renderMarkdownTypst(part)));
}

export function profileFilename(names: string[], title: string, today: string): string {
  const raw = names.length === 1 ? names[0]! : `${title} ${today}`;
  return `${raw.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim() || 'profile'}.pdf`;
}

/** Ein Druckbild aus der Mediathek; `null`, wenn das Medium fehlt, kein Rasterbild ist oder sich nicht lesen lässt. */
async function printImage(deps: Deps, assetId: string, variant: ImageVariant): Promise<ProfileImage | null> {
  const record = deps.db.select().from(core.mediaAssets).where(eq(core.mediaAssets.id, assetId)).get();
  if (!record) return null;
  try {
    const image = await ensureImageVariant(deps, record, variant);
    return image ? { ...image, checksum: createHash('sha256').update(image.bytes).digest('hex') } : null;
  } catch {
    return null; // Ein kaputtes Bild kostet das Foto, nicht die Mappe.
  }
}

async function profilePage(deps: Deps, animal: AnimalRecord, locale: string, labels: ProfileLabels, urlTemplate: string): Promise<ProfilePage> {
  const photos = [...animal.photos].sort((x, y) => x.sortOrder - y.sortOrder);
  const primary = photos.find((p) => p.isPrimary) ?? photos[0];
  const others = photos.filter((p) => p !== primary).slice(0, 3);
  const url = animal.isPublished ? profileUrl(urlTemplate, animal.slug) : null;
  const thumbs = await Promise.all(others.map((p) => printImage(deps, p.assetId, 'printThumb')));
  return {
    name: animal.name,
    facts: profileFacts(animal, locale, labels),
    traits: animal.traits[locale] ?? [],
    summary: animal.summary[locale] ?? '',
    paragraphs: await bodyParagraphs(animal.body[locale] ?? ''),
    photo: primary ? await printImage(deps, primary.assetId, 'print') : null,
    thumbs: thumbs.filter((t): t is ProfileImage => t !== null),
    qr: url ? qrRows(url) : null,
    url: url ?? '',
    more: labels.more.replaceAll('{name}', animal.name),
    continued: labels.continued,
  };
}

/**
 * Tierprofile als ein PDF, eine Seite je Tier, in der übergebenen
 * Reihenfolge (Spec 2026-10-05, § 6). Über den Auszugsweg des Kerns:
 * `exportDocument` prüft `documents.export`, rendert und protokolliert. Die
 * Rechte stehen hier vorn, damit ohne sie kein Druckbild gerechnet wird.
 */
export async function exportAnimalProfiles(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; mimeType: string }>> {
  const denied = requirePermission(ctx, 'animals.view') ?? requirePermission(ctx, 'documents.export');
  if (denied) return denied;
  const parsed = validate(deps, exportProfilesSchema, input);
  if (!parsed.ok) return parsed;
  const { ids, labels } = parsed.value;

  const animals: AnimalRecord[] = [];
  for (const id of ids) {
    const animal = loadAnimal(deps.db, id);
    if (!animal) return notFound('animal', id);
    animals.push(animal);
  }

  const locale = defaultLocale(deps);
  const urlTemplate = readSetting<string>(deps, PROFILE_URL_KEY);
  const frame = readSetting<PhotoFrame>(deps, PHOTO_FRAME_KEY);
  const [w, h] = frame.aspect.split(':').map(Number) as [number, number];
  const pages: ProfilePage[] = [];
  for (const animal of animals) pages.push(await profilePage(deps, animal, locale, labels, urlTemplate));

  const profileInput: ProfileInput = { frame: { aspect: [w, h], focusX: frame.focusX, focusY: frame.focusY }, pages };
  const exported = await exportDocument(deps, ctx, { templateKey: PROFILE_TEMPLATE_KEY, input: profileInput });
  if (!exported.ok) return exported;
  return ok({ ...exported.value, filename: profileFilename(animals.map((a) => a.name), labels.title, todayIn(deps)) });
}
