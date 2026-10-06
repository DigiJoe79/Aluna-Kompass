import { documentImagePath, type DocumentImage, type DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { PROFILE_LIB } from './profile-lib';

export const PROFILE_TEMPLATE_KEY = 'animals-profile';
/** Joe 2026-10-05 nach Ansicht des Prototyps: schmale Ränder, die Seite gehört dem Tier. */
export const PROFILE_BASE = 'a4-plain-slim';
export const PROFILE_MAX_PAGES = 200;

const imageSchema = z.object({
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'invalidBytes' }),
  checksum: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ProfileImage = z.infer<typeof imageSchema>;

export const profilePageSchema = z.object({
  name: z.string().min(1),
  /** Fertige Beschriftungen der Fakten-Marken, leere schon entfernt. */
  facts: z.array(z.string()),
  traits: z.array(z.string()),
  /** Klartext. */
  summary: z.string(),
  /** Typst-Markup je Absatz, aus Markdown gewandelt (`renderMarkdownTypst`). */
  paragraphs: z.array(z.string()),
  photo: imageSchema.nullable(),
  thumbs: z.array(imageSchema).max(3),
  /** Zeilen aus `qrRows`; `null` ohne Online-Profil. */
  qr: z.array(z.string().regex(/^[01]+$/)).nullable(),
  url: z.string(),
  more: z.string(),
  continued: z.string(),
});
export type ProfilePage = z.infer<typeof profilePageSchema>;

export const profileInputSchema = z.object({
  frame: z.object({
    aspect: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    focusX: z.number().int().min(0).max(100),
    focusY: z.number().int().min(0).max(100),
  }),
  pages: z.array(profilePageSchema).min(1).max(PROFILE_MAX_PAGES),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Freitext als Typst-String-Literal: Darin wirkt nichts als Markup. */
const str = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
/** Typst-Array; ein einzelnes Element braucht das Komma, sonst wäre es eine Klammer. */
const arr = (items: string[]) => (items.length === 0 ? '()' : `(${items.join(', ')},)`);

function pageCall(page: ProfilePage, index: number, frame: ProfileInput['frame'], images: Record<string, DocumentImage>): string {
  const image = (key: string, img: ProfileImage) => {
    images[key] = { bytes: img.bytes, checksum: img.checksum };
    return `(path: ${str(documentImagePath(key, img.bytes))}, w: ${img.width}, h: ${img.height})`;
  };
  const fields = [
    `name: ${str(page.name)}`,
    `photo: ${page.photo ? image(`p${index}-photo`, page.photo) : 'none'}`,
    `aspect: (${frame.aspect[0]}, ${frame.aspect[1]}), focus: (${frame.focusX}, ${frame.focusY})`,
    `thumbs: ${arr(page.thumbs.map((thumb, j) => image(`p${index}-thumb-${j}`, thumb)))}`,
    `facts: ${arr(page.facts.map(str))}`,
    `traits: ${arr(page.traits.map(str))}`,
    `summary: ${str(page.summary)}`,
    `paragraphs: ${arr(page.paragraphs.map((p) => `[${p}]`))}`,
    `qr: ${page.qr ? arr(page.qr.map(str)) : 'none'}`,
    `url: ${str(page.url)}`,
    `more: ${str(page.more)}`,
    `continued: ${str(page.continued)}`,
  ];
  return `#profile-page((${fields.join(', ')}))`;
}

/**
 * Tierprofile als Ad-hoc-Auszug (Spec 2026-10-05): eine Seite je Tier, auf
 * Abruf gezogen, nie abgelegt. Der Titel-Slot bleibt leer, sonst zeichnete
 * die Basis auf Seite 1 einen Titelblock über das erste Tier; den Dateinamen
 * setzt der Dienst.
 */
export const animalProfileTemplate: DocumentTemplate<ProfileInput> = {
  key: PROFILE_TEMPLATE_KEY,
  type: 'animal-profile',
  schema: profileInputSchema,
  permission: 'animals.view',
  base: PROFILE_BASE,
  filed: false,
  build: (data) => {
    const images: Record<string, DocumentImage> = {};
    const pages = data.pages.map((page, i) => pageCall(page, i, data.frame, images));
    return { slots: { kind: 'plain' }, body: { typst: `${PROFILE_LIB}\n${pages.join('\n#pagebreak()\n')}\n` }, images };
  },
};
