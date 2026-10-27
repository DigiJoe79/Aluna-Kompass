import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { AUDIT_REPORT_TYPE_KEY } from '../reporting/finalize';
import { typstText as t } from '../typst-pure';

/**
 * Der Druck des Prüfberichts (Spec § D1 Schritt 6, Designer Runde 3 12d/12g): „Zum Unterschreiben drucken“ auf
 * `a4-plain-slim`, in den Abschnitten des Formulars; der Vordruck für Papier-Prüfer setzt ein, was Kompass weiß, und
 * lässt den Rest als leere Zeilen. `filed: false` — gültig ist der abgelegte Scan. Texte des Papiers fest deutsch in
 * der Modul-Vorlage (Prinzip 7, wie die übrigen Vorlagen der Finanzen). Rein: alles kommt fertig formatiert.
 */
export const AUDIT_REPORT_PRINT_TEMPLATE_KEY = 'finance-audit-report-print';

const line = z.object({ label: z.string(), value: z.string() });
const signature = z.object({ name: z.string(), notSignedReason: z.string().nullable() });
const part = z.object({
  /** Bei getrennten Berichten der Name des Prüfers, sonst leer. */
  heading: z.string().nullable(),
  /** `null`: leere Kästchen (Papier-Prüfer, Vordruck). */
  result: z.enum(['clean', 'withFindings']).nullable(),
  recommendation: z.enum(['discharge', 'noDischarge', 'none']).nullable(),
  deviations: z.array(z.object({ name: z.string(), text: z.string().nullable() })),
  signatures: z.array(signature),
});

export const auditReportPrintInputSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  draft: z.boolean(),
  footerNote: z.string(),
  subject: z.array(line),
  /** Nachtrag: Nummern der seit dem abgelegten Bericht geänderten Buchungen. */
  changed: z.array(z.string()).nullable(),
  /** `null` im Vordruck: leere Zeilen. */
  examination: z.object({ dates: z.string(), place: z.string(), notTested: z.string() }).nullable(),
  findings: z.array(z.string()),
  openQuestions: z.array(z.string()),
  /** Vordruck: Platz für Feststellungen von Hand. */
  blankRemarks: z.boolean(),
  parts: z.array(part).min(1),
});
export type AuditReportPrintInput = z.infer<typeof auditReportPrintInputSchema>;

const emptyLines = (n: number) => Array.from({ length: n }, () => '#line(length: 100%, stroke: 0.4pt)').join(' #v(6mm) ');
const box = (checked: boolean) => (checked ? '☒' : '☐');

function partTypst(p: z.infer<typeof part>): string {
  const out: string[] = [];
  if (p.heading) out.push(`== ${t(p.heading)}`);
  out.push('=== Ergebnis');
  out.push(`${box(p.result === 'clean')} ohne Beanstandung #h(8mm) ${box(p.result === 'withFindings')} mit Feststellungen`);
  out.push('=== Empfehlung zur Entlastung');
  out.push(p.recommendation === null ? `${box(false)} Entlastung empfohlen #h(8mm) ${box(false)} Entlastung nicht empfohlen` : p.recommendation === 'none' ? 'Keine Angabe' : p.recommendation === 'discharge' ? 'Die Prüfer empfehlen der Mitgliederversammlung, den Vorstand zu entlasten.' : 'Die Prüfer empfehlen der Mitgliederversammlung nicht, den Vorstand zu entlasten.');
  for (const d of p.deviations) {
    out.push(`=== Abweichende Feststellungen · ${t(d.name)}`);
    out.push(d.text === null ? `#v(4mm) ${emptyLines(4)}` : d.text ? t(d.text) : 'Keine.');
  }
  out.push('=== Unterschriften');
  for (const s of p.signatures) {
    out.push(s.notSignedReason !== null
      ? `${t(s.name)}: nicht unterschrieben: ${t(s.notSignedReason)}`
      : `#v(10mm) #grid(columns: (1fr, 1fr), gutter: 8mm, [#line(length: 100%, stroke: 0.4pt) #text(size: 8pt)[Ort, Datum]], [#line(length: 100%, stroke: 0.4pt) #text(size: 8pt)[Unterschrift ${t(s.name)}]])`);
  }
  return out.join('\n\n');
}

export function buildAuditReportPrint(data: AuditReportPrintInput) {
  const body: string[] = [];
  body.push('== Gegenstand der Prüfung');
  body.push(`#table(columns: (auto, 1fr), stroke: none, inset: (x: 0pt, y: 3pt), ${data.subject.map((l) => `[${t(l.label)}], [${t(l.value)}]`).join(', ')})`);
  if (data.changed) body.push(data.changed.length ? `Seit der Prüffassung geändert: ${data.changed.length} Buchungen (${data.changed.map(t).join(', ')}).` : 'Seit der Prüffassung geändert: keine Buchungen.');
  body.push('== Prüfung');
  body.push(data.examination
    ? `#table(columns: (auto, 1fr), stroke: none, inset: (x: 0pt, y: 3pt), [Geprüft am], [${t(data.examination.dates)}], [Ort], [${t(data.examination.place)}], [Nicht geprüft], [${t(data.examination.notTested)}])`
    : `Geprüft am: #v(2mm) ${emptyLines(1)} #v(4mm) Ort: #v(2mm) ${emptyLines(1)} #v(4mm) Nicht geprüft: #v(2mm) ${emptyLines(2)}`);
  body.push('== Feststellungen');
  body.push(data.findings.length ? data.findings.map((f) => `- ${t(f)}`).join('\n') : data.blankRemarks ? emptyLines(4) : 'Keine.');
  body.push('== Offene Fragen (nicht abschließend geklärt)');
  body.push(data.openQuestions.length ? data.openQuestions.map((q) => `- ${t(q)}`).join('\n') : data.blankRemarks ? emptyLines(3) : 'Keine.');
  body.push(data.parts.map(partTypst).join('\n\n#pagebreak()\n\n'));
  return {
    base: 'a4-plain-slim',
    slots: { kind: 'report' as const, title: data.title, subtitle: data.subtitle, stage: data.draft ? ('preliminary' as const) : ('final' as const), ...(data.draft ? { stageText: 'ENTWURF' } : {}), footerNote: data.footerNote },
    body: { typst: body.join('\n\n') },
  };
}

export const auditReportPrintTemplate: DocumentTemplate<AuditReportPrintInput> = {
  key: AUDIT_REPORT_PRINT_TEMPLATE_KEY,
  type: AUDIT_REPORT_TYPE_KEY,
  schema: auditReportPrintInputSchema,
  base: 'a4-plain-slim',
  permission: 'finance.read',
  filed: false,
  build: (data) => buildAuditReportPrint(data),
};
