import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { typstText as t } from '../typst-pure';

/**
 * Die Prüfmappe für Papier-Prüfer (Spec § D1 Bausteine, Designer Runde 1 4c): Deckblatt mit Verein, Jahr, Prüfern,
 * Stand und Hash; Inhaltsverzeichnis; die acht Abschnitte des Prüfpakets als Listen, das Journal mit Spalte
 * „✓ / Anmerkung“; zwei Bögen „Fragen und Feststellungen“ mit Feld „Nr. / Seite“. Ergebnisdatei eines Laufs, kein
 * Dokument der Akte (`filed: false`). Texte fest deutsch (Papier, Prinzip 7). Rein.
 */
export const AUDIT_FOLDER_TEMPLATE_KEY = 'finance-audit-folder';

export const auditFolderInputSchema = z.object({
  title: z.string().min(1),
  cover: z.array(z.object({ label: z.string(), value: z.string() })),
  sections: z.array(z.object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())), checkColumn: z.boolean() })),
  footerNote: z.string(),
});
export type AuditFolderInput = z.infer<typeof auditFolderInputSchema>;

const cell = (v: string) => `[${t(v)}]`;

export function buildAuditFolder(data: AuditFolderInput) {
  const out: string[] = [];
  out.push(`#table(columns: (auto, 1fr), stroke: none, inset: (x: 0pt, y: 4pt), ${data.cover.map((l) => `${cell(l.label)}, ${cell(l.value)}`).join(', ')})`);
  out.push('== Inhalt');
  out.push(data.sections.map((s) => `+ ${t(s.title)}`).join('\n') + `\n+ ${t('Fragen und Feststellungen')}`);
  for (const s of data.sections) {
    out.push('#pagebreak()');
    out.push(`== ${t(s.title)}`);
    const columns = s.checkColumn ? [...s.columns, '✓ / Anmerkung'] : s.columns;
    if (s.rows.length === 0) out.push(t('Keine Einträge.'));
    else {
      const widths = columns.map((_, i) => (s.checkColumn && i === columns.length - 1 ? '3cm' : 'auto')).join(', ');
      const header = columns.map((c) => `[*${t(c)}*]`).join(', ');
      const body = s.rows.map((r) => [...r, ...(s.checkColumn ? [''] : [])].map(cell).join(', ')).join(',\n');
      out.push(`#text(size: 8pt)[#table(columns: (${widths}), table.header(${header}),\n${body})]`);
    }
  }
  for (let sheet = 1; sheet <= 2; sheet++) {
    out.push('#pagebreak()');
    out.push(`== ${t(`Fragen und Feststellungen (Bogen ${sheet})`)}`);
    out.push(`#table(columns: (2.5cm, 1fr), rows: (auto, ..((1.6cm,) * 12)), table.header([*${t('Nr. / Seite')}*], [*${t('Frage oder Feststellung')}*]), ${Array.from({ length: 12 }, () => '[], []').join(', ')})`);
  }
  return {
    base: 'a4-plain-slim',
    slots: { kind: 'report' as const, title: data.title, subtitle: 'Prüfmappe', stage: 'final' as const, footerNote: data.footerNote },
    body: { typst: out.join('\n\n') },
  };
}

export const auditFolderTemplate: DocumentTemplate<AuditFolderInput> = {
  key: AUDIT_FOLDER_TEMPLATE_KEY,
  type: AUDIT_FOLDER_TEMPLATE_KEY,
  schema: auditFolderInputSchema,
  base: 'a4-plain-slim',
  permission: 'finance.read',
  filed: false,
  build: (data) => buildAuditFolder(data),
};
