import { resolveRecordLabel, type CallContext, type Deps } from '@kompass/core';
import { languageName, settingLabel, type Label } from './audit-sentences';

export type AuditEntityLabel = { state: 'ok'; label: string } | { state: 'missing' };

/** Der Übersetzer des Namensraums `audit` — `getTranslations('audit')`, `useTranslations('audit')` oder `createTranslator`. */
type Translator = { has: (key: string) => boolean; (key: string): string };

/**
 * Typen, deren ID schon der Name ist oder deren Name aus der Oberfläche kommt — wie `DISPLAY` in
 * `audit-sentences.ts`: eine Einstellung mit ihrer Beschriftung (ohne Beschriftung kein Name), eine Sprache mit
 * ihrem Namen, eine Sicherung und ein Export der Akte mit ihrem Dateinamen.
 */
const NAMED_BY_ID: Record<string, (id: string, h: { label: Label; locale: string }) => string | null> = {
  setting: (id, h) => settingLabel(id, { ...h, params: {} }),
  locale: (id, h) => languageName(id, { ...h, params: {} }),
  backup: (id) => id,
  documentBundle: (id) => id,
};

/**
 * Beschriftung der Objekte im Änderungsprotokoll, live aus dem Modul, dem der
 * Datensatz gehört (`recordLabels`). Das Protokoll selbst trägt bei
 * Personendaten nur die ID (Befund 48): Solange der Datensatz existiert, steht
 * hier sein Name; ist er gelöscht, steht da, dass er gelöscht ist. Ohne Haken
 * oder ohne Leserecht gibt es keinen Eintrag — dann steht nur der Typ.
 */
export function auditEntityLabels(
  deps: Deps,
  ctx: CallContext,
  entries: { id: string; entityType: string; entityId: string | null }[],
  opts: { label?: Label; locale?: string } = {},
): Record<string, AuditEntityLabel> {
  const helpers = { label: opts.label ?? (() => null), locale: opts.locale ?? 'de' };
  const labels: Record<string, AuditEntityLabel> = {};
  for (const entry of entries) {
    if (!entry.entityId) continue;
    const byId = NAMED_BY_ID[entry.entityType];
    if (byId) {
      const name = byId(entry.entityId, helpers);
      if (name) labels[entry.id] = { state: 'ok', label: name };
      continue;
    }
    const label = resolveRecordLabel(deps, ctx, entry.entityType, entry.entityId);
    // `name` ist der bloße Name ohne Art; die Art setzt die Spalte selbst davor.
    const name = label?.name ?? label?.label;
    if (label?.state === 'ok' && name) labels[entry.id] = { state: 'ok', label: name };
    else if (label?.state === 'missing') labels[entry.id] = { state: 'missing' };
  }
  return labels;
}

/** Der Typ in Worten (`audit.entities.*`); ohne Wort der Schlüssel — den der Wächter `audit-actions` nie zulässt. */
export function auditEntityWord(t: Translator, entityType: string): string {
  return t.has(`entities.${entityType}`) ? t(`entities.${entityType}`) : entityType;
}

/** Das Objekt eines Eintrags in Teilen: „gelöscht“ steht eigens, damit die Anzeige es gedämpft setzt und es nicht wie ein Name aussieht. */
export type AuditObject = { word: string; name: string | null; deleted: string | null };

/**
 * Was die Spalte „Objekt“ zeigt, in Tabelle, Detail und PDF (Joe 2026-10-09): „Typ · Name“, bei einem gelöschten
 * Datensatz „Typ · gelöscht“, ohne Namen nur der Typ — nie die ID, die steht im Detail.
 */
export function auditObject(t: Translator, entry: { entityType: string }, label: AuditEntityLabel | undefined): AuditObject {
  return {
    word: auditEntityWord(t, entry.entityType),
    name: label?.state === 'ok' ? label.label : null,
    deleted: label?.state === 'missing' ? t('deletedRecord') : null,
  };
}
