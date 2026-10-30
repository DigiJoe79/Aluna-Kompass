import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { typstInline, typstText } from '../typst';

/** Wortlaut der Anlagen (Plan G4 Task 3) — fest deutsch im Modul wie das Protokoll. */
export const ATTACHMENT_WORDS = {
  attendanceTitle: 'Anwesenheitsliste',
  registerTitle: 'Angaben für die Registeranmeldung',
  registerNote: 'Nur für die notarielle Anmeldung zum Vereinsregister — nicht Teil des Protokolls.',
  voting: (has: boolean) => (has ? 'ja' : 'nein'),
  guest: 'Gast',
  /** Board 11e: Nr. · Name · Stimmrecht · Kommt · Geht · Unterschrift (leer zum Unterschreiben). */
  columnsAttendance: ['Nr.', 'Name', 'Stimmrecht', 'Kommt', 'Geht', 'Unterschrift'],
  /** Dieselben drei Zahlen wie der Kopf des Protokolls (G-12): stimmberechtigt, ohne Stimmrecht, Gäste. */
  summary: (voting: number, nonVoting: number, guests: number, peak: number, at: string | null) =>
    `${voting} ${voting === 1 ? 'stimmberechtigtes Mitglied' : 'stimmberechtigte Mitglieder'}${nonVoting > 0 ? `, ${nonVoting} ohne Stimmrecht` : ''}, ${guests} ${guests === 1 ? 'Gast' : 'Gäste'}.${at ? ` Höchststand ${peak} um ${at} Uhr.` : ''}`,
  /** Board 11f: Name · Amt · Geburtsdatum · Wohnort. */
  columnsRegister: ['Name', 'Amt', 'Geburtsdatum', 'Wohnort'],
  occasion: (meeting: string) => meeting,
  changeOffice: (office: string) => `Wechsel im Amt ${office}`,
  changeStatute: (positions: number[]) => `Satzungsänderung (TOP ${positions.join(', ')})`,
  representationWords: { single: 'jedes Vorstandsmitglied einzeln', two: 'je zwei Vorstandsmitglieder gemeinsam', all: 'alle Vorstandsmitglieder gemeinsam', majority: 'die Mehrheit der Vorstandsmitglieder' } as const,
  representation: (reference: string, rule: string, names: string[]) =>
    `Vertretungsberechtigt nach ${reference}: ${rule}.${names.length ? ` Die Anmeldung unterschreiben ${names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0]}.` : ''}`,
  /** Leerzeile zum Ausfüllen von Hand, wo Kompass nichts weiß. */
  blank: '__________',
};

const text = (max: number) => z.string().max(max);

export const attendanceListSchema = z.object({
  title: text(300).min(1),
  meeting: text(400),
  rows: z.array(z.object({ no: z.number().int().min(1), name: text(300), voting: text(20), arrivals: text(300), departures: text(300) })).max(5000),
  summary: text(300).default(''),
});
export type AttendanceListInput = z.infer<typeof attendanceListSchema>;

export const registerDataSchema = z.object({
  title: text(300).min(1),
  meeting: text(400),
  note: text(500),
  occasion: text(400).default(''),
  changes: text(400).default(''),
  rows: z.array(z.object({ name: text(300), office: text(200), status: z.enum(['new', 'left']), birthDate: text(20), city: text(200) })).max(50),
  representation: text(500).default(''),
});
export type RegisterDataInput = z.infer<typeof registerDataSchema>;

/** Eine Zelle; `muted` setzt sie in `brand.muted` (Ausgeschiedene auf dem Registerblatt). */
const cell = (value: string, muted = false) => (muted ? `text(fill: rgb(json("/data.json").brand.muted))${typstInline(value)}` : typstInline(value));

function table(columns: string[], rows: string[][], muted: boolean[] = []): string {
  const head = columns.map((c) => `[#strong${typstInline(c)}]`).join(', ');
  const body = rows.map((r, i) => r.map((v) => cell(v, muted[i] === true)).join(', ')).join(',\n    ');
  return [`#table(`, `    columns: ${columns.length}, stroke: 0.4pt, inset: 2mm,`, `    ${head}${rows.length ? ',' : ''}`, rows.length ? `    ${body}` : '', ')'].filter(Boolean).join('\n');
}

export const ATTENDANCE_LIST_TEMPLATE_KEY = 'governance-attendance-list';
export const REGISTER_DATA_TEMPLATE_KEY = 'governance-register-data';

export const attachmentTemplates: DocumentTemplate[] = [
  {
    key: ATTENDANCE_LIST_TEMPLATE_KEY,
    type: 'governance-attendance',
    schema: attendanceListSchema,
    base: 'a4-plain-slim',
    permission: 'governance.manage',
    build: (data: AttendanceListInput) => ({
      slots: { kind: 'report', title: data.title, subtitle: data.meeting },
      body: { typst: [table(ATTACHMENT_WORDS.columnsAttendance, data.rows.map((r) => [String(r.no), r.name, r.voting, r.arrivals, r.departures, ''])), ...(data.summary ? [typstText(data.summary)] : [])].join('\n\n') },
    }),
  } satisfies DocumentTemplate<AttendanceListInput>,
  {
    key: REGISTER_DATA_TEMPLATE_KEY,
    type: 'governance-register-data',
    schema: registerDataSchema,
    base: 'a4-plain-slim',
    permission: 'governance.manage',
    build: (data: RegisterDataInput) => ({
      slots: { kind: 'report', title: data.title, subtitle: data.meeting },
      body: {
        typst: [
          typstText(data.note),
          ...(data.occasion ? [typstText(data.occasion)] : []),
          ...(data.changes ? [typstText(data.changes)] : []),
          table(ATTACHMENT_WORDS.columnsRegister, data.rows.map((r) => [r.name, r.office, r.birthDate, r.city]), data.rows.map((r) => r.status === 'left')),
          ...(data.representation ? [typstText(data.representation)] : []),
        ].join('\n\n'),
      },
    }),
  } satisfies DocumentTemplate<RegisterDataInput>,
] as DocumentTemplate[];
