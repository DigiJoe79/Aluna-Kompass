import { recordAudit, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type SettingDefinition } from '@kompass/core';
import { z } from 'zod';
import { documentTypes } from './schema';

export const DEFAULT_TYPE_INCOMING = 'unclassified-in';
export const DEFAULT_TYPE_OUTGOING = 'unclassified-out';

export const DMS_SETTINGS: SettingDefinition[] = [
  { key: 'dms.defaultTypeIncoming', schema: z.string().min(1), default: DEFAULT_TYPE_INCOMING },
  { key: 'dms.defaultTypeOutgoing', schema: z.string().min(1), default: DEFAULT_TYPE_OUTGOING },
  /**
   * Welche Sprachen die Erkennung annimmt. Welche Pakete vorliegen, ist eine
   * Betriebstatsache und unterscheidet sich je Umgebung: Der Container meldet
   * `deu`, `eng`, `osd`, ein Entwicklungsrechner mit `tesseract-lang` meldet
   * über 160. Geprüft wird deshalb gegen `probe()`, nicht gegen eine Liste.
   */
  { key: 'dms.ocrLanguages', schema: z.string().regex(/^[a-z]{3}(\+[a-z]{3})*$/), default: 'deu+eng' },
];

/**
 * Die Beschriftung der beiden Startarten, in der führenden Sprache der
 * Installation. Das sind **Startwerte**, keine gepflegten Übersetzungen: Ab der
 * ersten Sekunde gehören die Arten dem Verein, der sie umbenennen darf.
 */
const LABELS: Record<string, { incoming: string; outgoing: string }> = {
  de: { incoming: 'Unklassifiziert (Eingang)', outgoing: 'Unklassifiziert (Ausgang)' },
  en: { incoming: 'Unclassified (incoming)', outgoing: 'Unclassified (outgoing)' },
};

/**
 * Was die Akte zum Arbeiten braucht und sonst niemand mitbringt: je Richtung
 * eine Art, unter der Post landet, die noch keiner eigenen Art zugeordnet ist.
 *
 * Bewusst **nur** diese zwei. Nummernkreise und Aufbewahrungsfristen sind
 * Entscheidungen des Vereins — ein Tierschutzverein und ein Modellbauverein
 * ordnen ihre Post verschieden. Ordner kommen aus demselben Grund keine mit.
 *
 * `statutory10Y` als Startwert ist die vorsichtige Richtung: Zu lange
 * aufzubewahren ist ein DSGVO-Ärgernis, zu kurz ein Steuerproblem — und nur
 * das zweite lässt sich nicht mehr heilen.
 */
export function installDms(tx: DbOrTx, deps: Deps, ctx: CallContext): void {
  if (tx.select().from(documentTypes).get()) return;

  const locale = deps.locales()[0] ?? 'de';
  const labels = LABELS[locale] ?? LABELS.de!;

  const starters = [
    { key: DEFAULT_TYPE_INCOMING, label: labels.incoming, prefix: 'EIN', defaultDirection: 'incoming' as const },
    { key: DEFAULT_TYPE_OUTGOING, label: labels.outgoing, prefix: 'AUS', defaultDirection: 'outgoing' as const },
  ];

  for (const [index, type] of starters.entries()) {
    tx.insert(documentTypes)
      .values({ ...type, retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: index })
      .run();
  }

  writeSettingInternal(tx, deps, ctx, 'dms.defaultTypeIncoming', DEFAULT_TYPE_INCOMING, 'dms.install');
  writeSettingInternal(tx, deps, ctx, 'dms.defaultTypeOutgoing', DEFAULT_TYPE_OUTGOING, 'dms.install');

  recordAudit(tx, deps, ctx, {
    action: 'dms.install',
    entityType: 'module',
    entityId: 'dms',
    after: { documentTypes: starters.map((type) => type.key) },
    summary: 'Akte eingerichtet: zwei unklassifizierte Dokumentarten angelegt',
  });
}
