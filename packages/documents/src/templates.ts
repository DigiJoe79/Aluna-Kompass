import { paperDate, type DocumentRenderContext, type DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

export function firstFontFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

/** Der Payload, den jede Basis-Vorlage als `payload` sieht. `slots` und `logoFile` ergänzt der Renderer/Kern. */
export function buildPayload(ctx: DocumentRenderContext) {
  const t = ctx.theme.tokens;
  return {
    organization: ctx.organization,
    number: ctx.number,
    issuedDate: paperDate(ctx.issuedDay),
    brand: {
      primary: t['color-primary'].light,
      primarySoft: t['color-primary-soft'].light,
      accent: t['color-accent'].light,
      ink: t.ink.light,
      muted: t.muted.light,
      line: t.line.light,
      fontBody: firstFontFamily(t['font-body'].light),
      fontHeading: firstFontFamily(t['font-heading'].light),
      fontMono: firstFontFamily(t['font-mono'].light),
    },
  };
}

/** Typst-String-Literal absichern. */
const q = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
/** Freitext ohne Markup-Wirkung (für den Einsatz zwischen `[ ]`). */
const esc = (s: string) => s.replace(/[\\#$[\]*_`~@<>]/g, (ch) => `\\${ch}`);

const auditEntrySchema = z.object({
  occurredAt: z.string(),
  userName: z.string().nullable(),
  channel: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  /** Der Name des Datensatzes, wo der Aufrufer ihn auflösen konnte; sonst steht die ID. */
  entityLabel: z.string().nullable().optional(),
  summary: z.string(),
});
const auditExportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.string()).default({}),
  entries: z.array(auditEntrySchema).max(2000),
});

/**
 * Die Änderungsprotokoll-Tabelle als Typst (datenlastig, kein Markdown).
 *
 * Die Breite gehört dem Inhalt: Zeitpunkt, Nutzer mit Kanal und Aktion stehen in festen, schmalen Spalten, der
 * Rest ist Objekt und Zusammenfassung. Zeitpunkt und Kanal kommen fertig formatiert vom Aufrufer.
 *
 * Die Kopfzeile trägt keinen Fettdruck: Jede Basis setzt sie selbst fett und hell auf ihre Hauptfarbe. Eine
 * Basis, die Fettes in eben dieser Farbe setzt, machte die Köpfe sonst unsichtbar (Befund 5, 0.2.2). Aus
 * demselben Befund: keine Silbentrennung in der Tabelle, und der Aktionsschlüssel bricht an seinen Punkten.
 */
function auditTable(data: z.infer<typeof auditExportSchema>): string {
  const filters = Object.entries(data.filters).map(([k, v]) => `${k}: ${v}`).join('; ');
  const breakable = (key: string) => `raw("${key.split('.').map((part) => part.replace(/[\\"]/g, (c) => `\\${c}`)).join('.\\u{200B}')}")`;
  const cells = data.entries.flatMap((e) => [
    `[${esc(e.occurredAt)}]`,
    `[${esc(e.userName ?? '—')} #linebreak() #text(size: 8pt)[${esc(e.channel)}]]`,
    breakable(e.action),
    `[${esc(`${e.entityType}${e.entityLabel ? ` · ${e.entityLabel}` : e.entityId ? ` · ${e.entityId}` : ''}`)} #linebreak() #text(size: 8.5pt)[${esc(e.summary)}]]`,
  ]);
  return [
    `#text(size: 9pt)[${esc(`Filter: ${filters || 'keine'}`)}]`,
    '#v(3mm)',
    '#{',
    '  set text(size: 9pt, hyphenate: false)',
    '  table(',
    '    columns: (21mm, 30mm, 34mm, 1fr),',
    '    table.header([Zeitpunkt], [Nutzer / Kanal], [Aktion], [Objekt / Zusammenfassung]),',
    `    ${cells.join(',\n    ')}`,
    '  )',
    '}',
  ].join('\n');
}

export function coreDocumentTemplates(): DocumentTemplate[] {
  const auditExport: DocumentTemplate<z.infer<typeof auditExportSchema>> = {
    key: 'audit-log-export',
    type: 'audit-export',
    schema: auditExportSchema,
    permission: 'audit.view',
    // Die schlanke Basis: schmale Ränder, die Breite gehört der Tabelle.
    base: 'a4-plain-slim',
    filed: false, // Ad-hoc-Auszug: wird gezogen und heruntergeladen, nicht abgelegt.
    build: (data) => ({
      slots: { kind: 'report', title: data.title },
      body: { typst: auditTable(data) },
    }),
  };

  return [auditExport as DocumentTemplate];
}
