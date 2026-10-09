import { paperDate, resolveRecordLabel, type AuditEntry, type AuditParam, type CallContext, type Deps, type IsoDay } from '@kompass/core';
import { dateFormatOf } from '@/lib/date-format';

/** `entityType`, unter dem `contactsRecordLabels` (packages/modules/contacts/src/record-labels.ts) Kontakte auflöst. */
const CONTACT_ENTITY = 'contact';

/** Der Übersetzer des Namensraums `audit` — `getTranslations('audit')` auf dem Server, `createTranslator` im Test. */
export type SentenceTranslator = {
  has: (key: string) => boolean;
  (key: string, values?: Record<string, string | number | boolean>): string;
};

/** Beschriftungen der Oberfläche für `DISPLAY`, aus einem Übersetzer über alle Namensräume (`getTranslations()`). */
export const labelsFrom =
  (t: { has: (key: string) => boolean; (key: string, values?: Record<string, string | number>): string }) =>
  (messageKey: string, values?: Record<string, string | number>): string | null =>
    t.has(messageKey) ? t(messageKey, values) : null;

/** Schlüssel des Satzes einer Aktion unter `audit`: Punkte werden wie bei `audit.actions` zu Unterstrichen. */
export const auditSentenceKey = (action: string): string => `sentences.${action.replaceAll('.', '_')}`;

type Entry = Pick<AuditEntry, 'id' | 'action' | 'params' | 'paramUserNames'>;

/** Was ein gespeicherter Code in der Anzeige heißt: Text aus der Oberfläche, sonst `null` (dann steht der Klartext). */
type Label = (messageKey: string, values?: Record<string, string | number>) => string | null;
type Display = (value: AuditParam, helpers: { label: Label; locale: string; params: Record<string, AuditParam> }) => string | null;

/** Eine Aufzählung wie in der Oberfläche: „a“, „b“ und „c“ (`Intl.ListFormat`, Designer 2026-10-09). */
const listOf = (items: string[], locale: string): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);

const settingLabel: Display = (v, h) => h.label(`settings.fields.${String(v)}`);
const datedValueLabel: Display = (v, h) => h.label(`finance.admin.datedValues.keys.${String(v)}`);
const languageName: Display = (v, h) => {
  try {
    return new Intl.DisplayNames([h.locale], { type: 'language' }).of(String(v)) ?? null;
  } catch {
    return null;
  }
};
/** Eine gespeicherte Liste („a, b“) mit jedem Eintrag in deutschen Anführungszeichen (Designer 2026-10-09). */
const quotedList: Display = (v, h) => {
  const items = String(v).split(', ').filter(Boolean);
  return items.length ? listOf(items.map((item) => `„${item}“`), h.locale) : null;
};
/** Was die Startinhalte mitbrachten, ohne Teile mit 0; alle 0 → kein Satz. */
const seedParts: Display = (_v, h) => {
  const parts = [
    ['audit.parts.siteSeed.variables', h.params.variables],
    ['audit.parts.siteSeed.entries', h.params.entries],
    ['audit.parts.siteSeed.assets', h.params.assets],
  ] as const;
  const shown = parts.filter(([, count]) => typeof count === 'number' && count > 0).map(([key, count]) => h.label(key, { count: count as number }));
  if (shown.length === 0 || shown.some((part) => part === null)) return null;
  return listOf(shown as string[], h.locale);
};
const megabytes: Display = (v, h) => `${new Intl.NumberFormat(h.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(v) / (1024 * 1024))} MB`;

/**
 * Werte, die gespeichert ein Code bleiben (Spec Protokoll § 2) und im Satz so heißen wie in der Oberfläche
 * (Designer 2026-10-09): Einstellungen mit ihrer Beschriftung, Sprachen mit ihrem Namen, Größen in MB.
 */
const DISPLAY: Record<string, Record<string, Display>> = {
  'settings.update': { key: settingLabel },
  'finance.datedValue.set': { key: datedValueLabel },
  'finance.datedValue.remove': { key: datedValueLabel },
  'locale.add': { code: languageName },
  'locale.remove': { code: languageName },
  'backup.export': { sizeBytes: megabytes },
  'site.values.update': { variables: quotedList },
};

/**
 * Platzhalter, die kein gespeicherter Wert sind, sondern aus mehreren gebaut werden — mit eigenem Namen, damit
 * man sie nicht mit einem gespeicherten verwechselt (Designer 2026-10-09: `{items}` statt `{variables}`). Der
 * Wächter `audit-sentences-catalog` erlaubt sie neben den Werten des Katalogs.
 */
export const DERIVED: Record<string, Record<string, Display>> = {
  // „12 Variablen, 8 Einträge und 5 Dateien“ aus `variables`, `entries`, `assets`.
  'site.seed.apply': { items: seedParts },
};

const isUserParam = (p: string) => /(^u|U)serId$/.test(p);
const isContactParam = (p: string) => /(^c|C)ontactId$/.test(p);

/** Name des Platzhalters zu einem Parameter: Personen ohne die Endung `Id` (`targetUserId` → `targetUser`, `contactId` → `contact`). */
export function sentencePlaceholder(param: string): string {
  return /(UserId|ContactId|^contactId|^userId)$/.test(param) ? param.slice(0, -2) : param;
}

/**
 * Der Satz eines Protokolleintrags aus `audit.sentences.*` (Spec Protokoll § 4). `null`, wenn es keinen gibt oder
 * ein Wert fehlt (ein alter Eintrag ohne `params`, ein später geänderter Satz) — dann steht der Klartext der
 * Aktion, nie ein halber Satz. Personen werden hier aufgelöst: Nutzer aus `paramUserNames` (wie `userName`),
 * Kontakte über `recordLabels` mit Rechteprüfung; lässt sich eine nicht auflösen (gelöscht, ohne Leserecht), steht
 * ebenfalls der Klartext (Designer 2026-10-09) — nie ihre ID. Gespeicherte Werte zu einem gelöschten Objekt bleiben
 * als Momentaufnahme im Satz. Datumswerte (Schlüssel auf `At`/`On`) am Bildschirm nach der
 * Einstellung, auf Papier fest `TT.MM.JJJJ` (MUSTER § Datum).
 */
export function auditSentences(
  deps: Deps,
  ctx: CallContext,
  t: SentenceTranslator,
  entries: readonly Entry[],
  opts: { paper: boolean; label?: Label; locale?: string },
): Record<string, string | null> {
  const label: Label = opts.label ?? (() => null);
  const locale = opts.locale ?? 'de';
  const fmt = dateFormatOf(deps);
  const contactNames = new Map<string, string | null>();
  const contactName = (id: string): string | null => {
    if (!contactNames.has(id)) {
      const label = resolveRecordLabel(deps, ctx, CONTACT_ENTITY, id);
      contactNames.set(id, label?.state === 'ok' && label.label ? label.label : null);
    }
    return contactNames.get(id) ?? null;
  };
  const dateValue = (param: string, value: string): string => {
    if (opts.paper) return paperDate(value.slice(0, 10) as IsoDay);
    return param.endsWith('At') ? fmt.dateTime(value) : fmt.date(value);
  };

  const out: Record<string, string | null> = {};
  for (const entry of entries) {
    out[entry.id] = null;
    const def = deps.registry.auditActions.get(entry.action);
    const key = auditSentenceKey(entry.action);
    const params = entry.params;
    if (!def || !params || !t.has(key)) continue;
    // Ein fehlender oder leerer Wert ergäbe einen halben Satz: dann der Klartext.
    if (def.params.some((p) => params[p] === undefined || params[p] === null)) continue;
    const values: Record<string, string | number | boolean> = {};
    let unresolved = false;
    for (const [p, v] of Object.entries(params)) {
      if (v === null) continue;
      if (isUserParam(p) || isContactParam(p)) {
        const name = isUserParam(p) ? (entry.paramUserNames[String(v)] ?? null) : contactName(String(v));
        if (name === null) unresolved = true;
        else values[sentencePlaceholder(p)] = name;
      } else if (DISPLAY[entry.action]?.[p]) {
        const shown = DISPLAY[entry.action]![p]!(v, { label, locale, params });
        if (shown === null) unresolved = true;
        else values[p] = shown;
      } else if (typeof v === 'string' && (p.endsWith('At') || p.endsWith('On'))) values[p] = dateValue(p, v);
      else values[p] = v;
    }
    for (const [name, build] of Object.entries(DERIVED[entry.action] ?? {})) {
      const shown = build(null, { label, locale, params });
      if (shown === null) unresolved = true;
      else values[name] = shown;
    }
    // Eine Person, die sich nicht mehr auflösen lässt (gelöscht, ohne Leserecht), oder ein Code ohne Beschriftung
    // nennt der Satz nicht: Klartext.
    if (unresolved) continue;
    try {
      const sentence = t(key, values);
      // next-intl wirft nicht, sondern liefert bei einem Formatfehler den Schlüssel — der ist kein Satz.
      out[entry.id] = sentence === key || sentence.endsWith(`.${key}`) ? null : sentence;
    } catch {
      out[entry.id] = null;
    }
  }
  return out;
}
