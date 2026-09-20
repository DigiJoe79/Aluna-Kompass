import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

export type BundleEntryState = 'ok' | 'voided' | 'altered' | 'missing' | 'protected' | 'noAccess';

export interface BundleEntry {
  number: string;
  documentDate: string | null;
  typeLabel: string | null;
  subject: string | null;
  checksum: string | null;
  state: BundleEntryState;
  /** Name der Datei im Bündel; `null`, wenn keine beiliegt. */
  fileName: string | null;
}

/**
 * Das Verzeichnis ist ein Dokument des Vereins und deutsch wie seine Briefe —
 * kein Oberflächentext. `altered` und `missing` stehen hier, weil ein Prüfer
 * wissen muss, dass eine Datei fehlt, und warum.
 */
export const BUNDLE_STATE_LABELS: Record<BundleEntryState, string> = {
  ok: 'in Ordnung',
  voided: 'storniert',
  altered: 'Datei verändert – nicht beigelegt',
  missing: 'Datei fehlt',
  protected: 'geschützt',
  noAccess: 'kein Zugriff',
};

const HEADER = ['Nummer', 'Datum', 'Art', 'Betreff', 'SHA-256', 'Status', 'Datei'];

/** Semikolon und BOM: So öffnet es ein deutsches Excel ohne Importdialog. */
function csvField(value: string | null): string {
  if (value === null || value === '') return '';
  // Ein Betreff ist fremder Text (Eingangspost): Was mit = + - @ beginnt, führte eine Tabellenkalkulation als Formel aus.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n']/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function bundleCsv(entries: readonly BundleEntry[]): string {
  const rows = entries.map((e) => [e.number, e.documentDate, e.typeLabel, e.subject, e.checksum, BUNDLE_STATE_LABELS[e.state], e.fileName].map(csvField).join(';'));
  return `﻿${[HEADER.join(';'), ...rows].join('\r\n')}\r\n`;
}

const cell = (value: string | null): string => (value ?? '').replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ');

export function bundleIndexMarkdown(entries: readonly BundleEntry[]): string {
  const lines = entries.map((e) => `| ${cell(e.number)} | ${cell(e.documentDate)} | ${cell(e.typeLabel)} | ${cell(e.subject)} | ${BUNDLE_STATE_LABELS[e.state]} |`);
  return ['| Nummer | Datum | Art | Betreff | Status |', '|---|---|---|---|---|', ...lines].join('\n');
}

const entrySchema = z.object({ number: z.string(), documentDate: z.string().nullable(), typeLabel: z.string().nullable(), subject: z.string().nullable(), checksum: z.string().nullable(), state: z.enum(['ok', 'voided', 'altered', 'missing', 'protected', 'noAccess']), fileName: z.string().nullable() });

/** Das Inhaltsverzeichnis eines Bündels. `filed: false`: ein Auszug, kein Akteneintrag, keine Nummer. */
export const bundleIndexTemplate: DocumentTemplate<{ title: string; entries: BundleEntry[] }> = {
  key: 'dms-bundle-index',
  type: 'dms-bundle-index',
  schema: z.object({ title: z.string().min(1), entries: z.array(entrySchema) }),
  base: 'a4-mit-briefkopf',
  filed: false,
  build: (data) => ({
    slots: { kind: 'report', title: data.title },
    body: { markdown: `${bundleIndexMarkdown(data.entries)}\n\nDie Prüfsummen (SHA-256) stehen in der beiliegenden Datei inhaltsverzeichnis.csv.` },
  }),
};
