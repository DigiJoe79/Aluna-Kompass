import type { DocumentRenderContext, DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

export function firstFontFamily(stack: string): string {
  const first = stack.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Der Payload, den jede Basis-Vorlage als `payload` sieht. `slots` und `logoFile` ergänzt der Renderer/Kern. */
export function buildPayload(ctx: DocumentRenderContext) {
  const t = ctx.theme.tokens;
  return {
    organization: ctx.organization,
    number: ctx.number,
    issuedDate: formatGermanDate(ctx.issuedAt),
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

/** Typst-String literal absichern (Werte aus dem Bestand). */
const q = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

const letterheadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20_000).default(''),
  base: z.string().optional(),
});

const auditEntrySchema = z.object({
  occurredAt: z.string(),
  userName: z.string().nullable(),
  channel: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  summary: z.string(),
});
const auditExportSchema = z.object({
  title: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.string()).default({}),
  entries: z.array(auditEntrySchema).max(2000),
});

/** Die Änderungsprotokoll-Tabelle als Typst (datenlastig, kein Markdown). */
function auditTable(data: z.infer<typeof auditExportSchema>): string {
  const filters = Object.entries(data.filters).map(([k, v]) => `${k}: ${v}`).join('; ');
  const rows = data.entries
    .map((e) => {
      const cells = [
        `raw(${q(e.occurredAt)})`,
        `[${e.userName ?? '\\u{2014}'}]`,
        `[${e.channel}]`,
        `raw(${q(e.action)})`,
        `[${e.entityType}${e.entityId ? ` \\u{00B7} ${e.entityId}` : ''} \\\n#text(size: 8.5pt)[${e.summary.replace(/[\]\\]/g, (c) => `\\${c}`)}]]`,
      ];
      return `(${cells.join(', ')})`;
    })
    .join(',\n  ');
  return [
    `#text(size: 9pt)[Filter: ${filters || 'keine'}]`,
    '#v(3mm)',
    '#table(',
    '  columns: (auto, auto, auto, auto, 1fr),',
    '  table.header([*Zeitpunkt*], [*Nutzer*], [*Kanal*], [*Aktion*], [*Objekt / Zusammenfassung*]),',
    `  ${rows}`,
    ')',
  ].join('\n');
}

export function coreDocumentTemplates(): DocumentTemplate[] {
  const letterhead: DocumentTemplate<z.infer<typeof letterheadSchema>> = {
    key: 'letterhead',
    prefix: 'BRF',
    schema: letterheadSchema,
    base: 'a4-mit-briefkopf',
    build: (data) => ({
      base: data.base,
      slots: { kind: 'letter', title: data.title, subject: data.title },
      body: { markdown: data.body },
    }),
  };

  const auditExport: DocumentTemplate<z.infer<typeof auditExportSchema>> = {
    key: 'audit-log-export',
    prefix: 'PRO',
    schema: auditExportSchema,
    permission: 'audit.view',
    base: 'a4-plain',
    build: (data) => ({
      slots: { kind: 'report', title: data.title },
      body: { typst: auditTable(data) },
    }),
  };

  return [letterhead as DocumentTemplate, auditExport as DocumentTemplate];
}
