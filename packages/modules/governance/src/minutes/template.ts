import type { DocumentTemplate } from '@kompass/core';
import { typstInline, typstText } from '../typst';
import { minutesInputSchema, type MinutesInput } from './compose';

/** Protokollentwurf der Mitgliederversammlung (Art `minutes`, `PRT`) — Ausdruck ohne Ablage. */
export const MINUTES_PRINT_TEMPLATE_KEY = 'governance-minutes-print';
/** Protokollentwurf des Vorstands und anderer Organe (Art `governance-board-minutes`, `VSP`). */
export const BOARD_MINUTES_PRINT_TEMPLATE_KEY = 'governance-board-minutes-print';

const FINDINGS = 'Feststellungen';
const DEFECTS = 'Hinweise';
const SIGNATURES = 'Unterschriften';
const ATTACHMENTS = 'Anlagen';
const signature = (label: string) => `[#line(length: 100%, stroke: 0.4pt) #text(size: 8pt)${typstInline(label)}]`;

/** Ein Mangel als eigener Absatz mit Randstrich in `brand.muted` (Plan U2). */
const defectBlock = (content: string) => `#block(inset: (left: 3mm), stroke: (left: 1.5pt + rgb(json("/data.json").brand.muted)))[${content}]`;

/** Der Typst-Körper: Kopf als Tabelle ohne Linien, je TOP Fließtext, Unterschriften im Raster. */
export function minutesBody(data: MinutesInput): string {
  const parts: string[] = [];
  if (data.head.length > 0) {
    const rows = data.head.map((h) => `[#strong${typstInline(h.label)}], ${typstInline(h.value)}`).join(',\n    ');
    parts.push(['#table(', '    columns: (auto, 1fr), stroke: none, inset: (x: 0mm, y: 1mm), column-gutter: 4mm,', `    ${rows}`, ')'].join('\n'));
  }
  if (data.findings.length > 0) parts.push(`#strong${typstInline(FINDINGS)}`, ...data.findings.map(typstText));
  if (data.defects.length > 0) parts.push(`#strong${typstInline(DEFECTS)}`, defectBlock(data.defects.map(typstText).join(' #parbreak() ')));
  // Je TOP eine fette Zeile, Fließtext, dann je Mangel ein Absatz mit Randstrich (Board 11c/11d).
  for (const item of data.items) {
    parts.push(`#strong${typstInline(item.heading)}`, ...item.paragraphs.map(typstText));
    for (const d of item.defects ?? []) parts.push(defectBlock(typstText(d)));
  }
  if (data.end) parts.push(typstText(data.end));
  parts.push(`#strong${typstInline(SIGNATURES)}`, typstText(data.placeDate));
  if (data.signatures.length > 0) parts.push(`#v(12mm) #grid(columns: (1fr, 1fr), gutter: 10mm, row-gutter: 14mm, ${data.signatures.map(signature).join(', ')})`);
  if (data.signaturesNote) parts.push(`#text(size: 8pt)${typstInline(data.signaturesNote)}`);
  if (data.attachments.length > 0) parts.push(`#strong${typstInline(ATTACHMENTS)}`, data.attachments.map((a) => `+ ${typstText(a)}`).join('\n'));
  return parts.join('\n\n');
}

function minutesTemplate(key: string, type: string): DocumentTemplate<MinutesInput> {
  return {
    key,
    type,
    schema: minutesInputSchema,
    base: 'a4-plain-slim',
    permission: 'governance.read',
    // Gültig ist der unterschriebene Scan (Task 4); der Ausdruck trägt das Wasserzeichen eines Entwurfs.
    filed: false,
    build: (data) => ({ slots: { kind: 'report', title: data.title, draft: true, ...(data.footerNote ? { footerNote: data.footerNote } : {}) }, body: { typst: minutesBody(data) } }),
  };
}

export const minutesPrintTemplates: DocumentTemplate[] = [minutesTemplate(MINUTES_PRINT_TEMPLATE_KEY, 'minutes'), minutesTemplate(BOARD_MINUTES_PRINT_TEMPLATE_KEY, 'governance-board-minutes')] as DocumentTemplate[];
