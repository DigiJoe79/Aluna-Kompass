export interface TemplateRow {
  key: string;
  /** Die Basis, die die Vorlage selbst vorgibt. */
  defaultBase: string;
  /** Die Übersteuerung aus den Einstellungen, wenn eine gesetzt ist. */
  override: string | null;
  /** Worauf das Dokument tatsächlich erscheint. */
  effectiveBase: string;
  effectiveLabel: string;
  /** Falsch, wenn die wirksame Basis fehlt oder fehlerhaft ist. */
  available: boolean;
}

export interface TemplateGroup {
  module: string;
  rows: TemplateRow[];
}

/**
 * Die Zuordnung „Dokumentart → Basis“ für die Seite Dokumentvorlagen, je Modul gruppiert, der Kern zuerst.
 *
 * Die Seite zeigte nur „Vorgabe der Vorlage“, ohne die Basis dahinter, und eine Übersteuerung sah aus wie jede
 * andere Zeile. Hier steht je Dokumentart, was die Vorlage vorgibt, was eingestellt ist und was daraus wirkt
 * (Befund vom 2026-09-30).
 */
export function documentTemplateGroups(
  templates: readonly { key: string; base: string }[],
  manifests: readonly { key: string; documentTemplates?: readonly { key: string }[] }[],
  configured: Readonly<Record<string, string>>,
  bases: readonly { id: string; label: string; ok: boolean }[],
): TemplateGroup[] {
  const owner = new Map<string, string>();
  for (const manifest of manifests) for (const template of manifest.documentTemplates ?? []) owner.set(template.key, manifest.key);
  const order = ['core', ...manifests.map((m) => m.key).filter((key) => key !== 'core')];
  const groups = new Map<string, TemplateRow[]>(order.map((key) => [key, []]));
  for (const template of templates) {
    const override = configured[template.key] ?? null;
    const effectiveBase = override ?? template.base;
    const base = bases.find((b) => b.id === effectiveBase);
    // Eine Vorlage, die kein Modul als seine meldet, kommt vom Kern.
    groups.get(owner.get(template.key) ?? 'core')!.push({
      key: template.key,
      defaultBase: template.base,
      override,
      effectiveBase,
      effectiveLabel: base?.label ?? effectiveBase,
      available: base?.ok === true,
    });
  }
  return [...groups].filter(([, rows]) => rows.length > 0).map(([module, rows]) => ({ module, rows }));
}
