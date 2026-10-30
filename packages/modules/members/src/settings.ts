import { localizedText, type LocalizedText, type SettingDefinition } from '@kompass/core';
import { z } from 'zod';

/** Stichtag einer Kündigung (Spec § 3.3): Ende des Geschäftsjahres, des Quartals, des Monats oder genau der Tag. */
export const RESIGNATION_ANCHORS = ['fiscalYearEnd', 'quarterEnd', 'monthEnd', 'any'] as const;
export type ResignationAnchor = (typeof RESIGNATION_ANCHORS)[number];

export const numberFormatSchema = z.object({ prefix: z.string().max(10), digits: z.number().int().min(1).max(8) });
export type MemberNumberFormat = z.infer<typeof numberFormatSchema>;

export const resignationNoticeSchema = z.object({ months: z.number().int().min(0).max(24), at: z.enum(RESIGNATION_ANCHORS) });
export type ResignationNotice = z.infer<typeof resignationNoticeSchema>;

/**
 * Eine Mahnstufe (Spec § 4.5): frühestens `daysAfter` Tage nach der Fälligkeit (erste Stufe; bei einem nach der
 * Fälligkeit angelegten Beitrag nach Anlage plus `members.paymentTermDays`) bzw. nach dem Versand der vorigen. Der Stufentext steht im Textbaustein `snippetId` der Akte — vom Verein änderbar; Kompass schreibt keine
 * Folge nach der Satzung hinein.
 */
export const dunningLevelSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
  name: localizedText({ required: true, max: 60 }),
  daysAfter: z.number().int().min(0).max(365),
  snippetId: z.string().min(1).nullable(),
});
export type DunningLevel = z.infer<typeof dunningLevelSchema> & { name: LocalizedText };
export const dunningLevelsSchema = z
  .array(dunningLevelSchema)
  .min(1)
  .max(6)
  .refine((list) => new Set(list.map((l) => l.key)).size === list.length, { message: 'duplicateLevelKey' });

/** Vorgabe: Erinnerung 14 Tage nach Fälligkeit, Mahnung und Letzte Mahnung je 28 Tage nach der vorigen. */
export const DEFAULT_DUNNING_LEVELS: DunningLevel[] = [
  { key: 'reminder', name: { de: 'Erinnerung', en: 'Reminder' }, daysAfter: 14, snippetId: null },
  { key: 'dunning', name: { de: 'Mahnung', en: 'Dunning letter' }, daysAfter: 28, snippetId: null },
  { key: 'finalDunning', name: { de: 'Letzte Mahnung', en: 'Final dunning letter' }, daysAfter: 28, snippetId: null },
];

/** Einstellungen des Moduls (Spec § 3.2, § 3.3, § 4). */
export const MEMBERS_SETTINGS: readonly SettingDefinition[] = [
  // Wie in den Finanzen (E10): Aufnehmen, Ablehnen und Löschen über einen Agenten erst, wenn ein Mensch das freischaltet.
  { key: 'members.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true },
  { key: 'members.numberFormat', schema: numberFormatSchema, default: { prefix: '', digits: 4 } },
  // Geschäftsjahr heißt hier Kalenderjahr: Das Geschäftsjahr der Finanzen braucht die Kündigungsfrist nicht, Vereine
  // mit abweichendem Jahr sind die Ausnahme (Plan M1, Task 1).
  { key: 'members.resignationNotice', schema: resignationNoticeSchema, default: { months: 3, at: 'fiscalYearEnd' }, managedBy: 'members' },
  // Beitrag im Eintrittsjahr (Entscheid Joe 2026-10-18); gelesen ab M3.
  { key: 'members.joinYearRule', schema: z.enum(['full', 'proRataMonths', 'nextYear']), default: 'full', managedBy: 'members' },
  // Zahlungsziel in Mahnung und Zahlungsaufforderung: „Bitte überweisen Sie … bis zum …“ (Plan M4, Handoff 2.6).
  { key: 'members.paymentTermDays', schema: z.number().int().min(1).max(90), default: 14, managedBy: 'members' },
  // Mahnstufen (Spec § 4.5); die Einrichtung legt die Textbausteine an und trägt sie ein.
  { key: 'members.dunningLevels', schema: dunningLevelsSchema, default: DEFAULT_DUNNING_LEVELS, managedBy: 'members' },
];
