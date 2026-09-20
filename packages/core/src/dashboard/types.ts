import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { PermissionSpec } from '../permissions/check';

/**
 * Eine Kachel der Startseite (Spec 2026-09-17, § 3). Ein Modul deklariert sie
 * im Manifest; der Kern lädt sie nur, wenn das Recht vorliegt, und zeigt sie
 * mit generischen Komponenten. Drei Formen decken alles ab, was heute ansteht.
 */
export type DashboardKind = 'count' | 'list' | 'status';
export type DashboardTone = 'neutral' | 'info' | 'warning';

export interface DashboardLine {
  /** ISO-Datum; fehlt bei Zeilen ohne Datum (Einrichtung). */
  date?: string;
  /** Text aus Daten (Betreff, Anlass) … */
  title?: string;
  /** … oder ein Schlüssel unter `dashboard.tiles.<modul>.<kachel>.messages`, mit `values`. Genau eins von beiden. */
  titleKey?: string;
  values?: Record<string, string | number>;
  /** Wohin die Zeile selbst führt. */
  href?: string | null;
  /** Ein beschrifteter Bezug (Dokumentnummer, Kontakt), eigener Link. */
  link?: { label: string; href: string | null };
  /** Zusatz rechts: Zuständige, Absender. */
  extra?: string;
  /** Warnfarbe (überfällig). */
  overdue?: boolean;
  /** Die einzige Aktion auf der Startseite: eine Wiedervorlage erledigen (Entscheidung 12). */
  action?: { kind: 'completeFollowUp'; followUpId: string };
}

export type DashboardContent =
  | { kind: 'count'; count: number; href: string | null }
  | { kind: 'list'; lines: DashboardLine[]; total: number; href: string | null }
  | { kind: 'status'; tone: DashboardTone; messageKey: string; values?: Record<string, string | number>; href: string | null };

export interface DashboardTile<O = Record<string, unknown>> {
  /** Eindeutig je Modul, camelCase. Beschriftung: `dashboard.tiles.<modul>.<key>.{title,empty,open}`. */
  key: string;
  /** Ein Recht oder eine Liste, von der eines genügt (Entscheidung 10, erweitert am 2026-09-20). */
  permission: PermissionSpec;
  /** Die Form, die `load` liefert — steht hier, damit die Seitenleiste die Breite kennt, ohne zu laden. */
  kind: DashboardKind;
  /** Vorgabe für Nutzer ohne eigene Anordnung (Entscheidung 3). */
  defaultOn: boolean;
  /** `z.object` aus boolean, enum oder integer, jedes Feld mit `.default()`; `z.object({})` ohne Optionen. */
  options: z.ZodType<O>;
  /** Jeder `messageKey` (status) und `titleKey` (list), den `load` liefern kann — für den Sprachwächter der App. */
  messageKeys?: readonly string[];
  /** Nur lesend, keine I/O außerhalb der Datenbank. Wird nur mit dem Recht gerufen. */
  load(deps: Deps, ctx: CallContext, options: O): DashboardContent | Promise<DashboardContent>;
}

export type DashboardOptionField =
  | { name: string; type: 'boolean'; default: boolean }
  | { name: string; type: 'enum'; values: string[]; default: string }
  | { name: string; type: 'integer'; min?: number; max?: number; default: number };

interface JsonProp {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

/**
 * Die Optionen einer Kachel als Felder, aus denen die Seitenleiste ihr Formular
 * baut. Über das JSON-Schema statt über Zod-Interna: Was Zod nicht als
 * boolean, string-enum oder integer mit Vorgabe ausgibt, nimmt der Kern nicht an.
 */
export function dashboardOptionFields(schema: z.ZodType): DashboardOptionField[] {
  const json = z.toJSONSchema(schema) as { type?: string; properties?: Record<string, JsonProp> };
  if (json.type !== 'object') throw new Error('dashboard tile options must be an object schema');
  return Object.entries(json.properties ?? {}).map(([name, prop]): DashboardOptionField => {
    if (!('default' in prop)) throw new Error(`dashboard tile option without default: ${name}`);
    if (prop.type === 'boolean') return { name, type: 'boolean', default: prop.default as boolean };
    if (prop.type === 'string' && Array.isArray(prop.enum)) return { name, type: 'enum', values: prop.enum.map(String), default: String(prop.default) };
    if (prop.type === 'integer') {
      const field: DashboardOptionField = { name, type: 'integer', default: prop.default as number };
      if (prop.minimum !== undefined) field.min = prop.minimum;
      if (prop.maximum !== undefined) field.max = prop.maximum;
      return field;
    }
    throw new Error(`unsupported dashboard tile option type: ${name}`);
  });
}
