import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

/**
 * Die generische Vorlage der Finanzberichte (Spec Rechenschaft 0.4.0 § A, Basis und PDF): Den Körper rechnet der
 * Bericht (`toTypst`), Stufe und Vermerk der Verteiler. Zwei Schlüssel, eine `build`: Die Dokumentart folgt dem
 * Personenbezug (`finance-report` / `finance-report-personal`). Akteneintrag — `exportDocument` rendert sie nie.
 */
export const REPORT_TEMPLATE_KEY = 'finance-report';
export const REPORT_PERSONAL_TEMPLATE_KEY = 'finance-report-personal';

/** Texte der Stufen auf dem Papier (Spec § A): fest deutsch wie die übrigen Vorlagen der Finanzen. */
export const STAGE_TEXT = {
  preliminary: 'VORLÄUFIG',
  review: 'Zur Prüfung – noch nicht festgeschrieben',
  // Spec § C, letzter Punkt: Geht die Prüffassung mit der Einladung raus, sagt sie, dass die MV die festgeschriebene bekommt.
  reviewAssembly: 'Zur Prüfung – wird der Mitgliederversammlung nach Abschluss der Prüfung festgeschrieben vorgelegt',
  finalWithoutAuditReport: 'Ohne schriftlichen Prüfbericht festgeschrieben',
} as const;

export const reportTemplateInputSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  /** Körper aus `toTypst` — nur der Verteiler setzt ihn. */
  typst: z.string(),
  stage: z.enum(['preliminary', 'review', 'final']),
  stageText: z.string(),
  footerNote: z.string(),
  orientation: z.enum(['portrait', 'landscape']),
});
export type ReportTemplateInput = z.infer<typeof reportTemplateInputSchema>;

/** Rein: keine Uhr, kein Zufall — die Erzeugungszeit kommt fertig im `footerNote`. */
export function buildReportDocument(data: ReportTemplateInput) {
  return {
    base: data.orientation === 'landscape' ? 'a4-quer-plain-slim' : 'a4-plain-slim',
    slots: { kind: 'report' as const, title: data.title, subtitle: data.subtitle, stage: data.stage, ...(data.stageText ? { stageText: data.stageText } : {}), ...(data.footerNote ? { footerNote: data.footerNote } : {}) },
    body: { typst: data.typst },
  };
}

const template = (key: string): DocumentTemplate<ReportTemplateInput> => ({
  key,
  type: key,
  schema: reportTemplateInputSchema,
  permission: 'finance.reportsFinalize',
  base: 'a4-plain-slim',
  build: (data) => buildReportDocument(data),
});

export const reportTemplate = template(REPORT_TEMPLATE_KEY);
export const reportPersonalTemplate = template(REPORT_PERSONAL_TEMPLATE_KEY);
