import { newId, provisionOnce, recordAudit, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type SettingDefinition } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAIL_BODY_DEFAULTS } from './mail/defaults';
import { documentSnippets, documentTypes } from './schema';

export interface DispatchChannel {
  key: string;
  label: string;
}

const CHANNEL_KEY = /^[a-z][a-zA-Z0-9]*$/;

/** Die Vorgabe in der Leitsprache; ein Verein ergänzt oder benennt um. */
export const DEFAULT_DISPATCH_CHANNELS: DispatchChannel[] = [
  { key: 'post', label: 'Post' },
  { key: 'registeredMail', label: 'Einschreiben' },
  { key: 'email', label: 'E-Mail' },
  { key: 'inPerson', label: 'Persönlich übergeben' },
  { key: 'portal', label: 'Portal' },
  { key: 'other', label: 'Sonstiges' },
];

export const dispatchChannelsSchema = z
  .array(z.object({ key: z.string().regex(CHANNEL_KEY), label: z.string().trim().min(1).max(60) }))
  .min(1)
  .refine((list) => new Set(list.map((c) => c.key)).size === list.length, { message: 'duplicateChannelKey' });

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
  /** Die Wege, die ein Versandvermerk kennt (Entscheidung 34). */
  { key: 'dms.dispatchChannels', schema: dispatchChannelsSchema, default: DEFAULT_DISPATCH_CHANNELS },
  /**
   * Absender der E-Mails (Spec PDF per E-Mail § 3). Die Adresse muss zum
   * Mailserver passen; Kompass prüft das nicht. Ohne Adresse wird nicht gesendet.
   */
  { key: 'dms.mail.fromAddress', schema: z.email().nullable(), default: null },
  /** `null` = Vereinsname (`organization.name`). */
  { key: 'dms.mail.fromName', schema: z.string().trim().min(1).max(120).nullable(), default: null },
  { key: 'dms.mail.replyTo', schema: z.email().nullable(), default: null },
  /** Schutz gegen die Grenzen des Providers: Der Sender verlangsamt, er sperrt nichts. */
  { key: 'dms.mail.ratePerMinute', schema: z.number().int().min(1).max(120), default: 20 },
  /** Begleittext je Dokumentart: Schlüssel der Art → ID eines Textbausteins. */
  { key: 'dms.mail.bodySnippetByType', schema: z.record(z.string(), z.string()), default: {} },
  /** Der Baustein der Grundausstattung; die Einrichtung setzt ihn. */
  { key: 'dms.mail.defaultBodySnippetId', schema: z.string().nullable(), default: null },
  /** Ein Agent darf humanOnly-Dienste der Akte (Senden) erst freigeschaltet nutzen — und das nur ein Mensch am Bildschirm. */
  { key: 'dms.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true },
];

/**
 * Der Begleittext der E-Mails als Textbaustein der Grundausstattung — genau
 * einmal je Installation (`provisionOnce`), auch in einer Akte, die längst
 * eingerichtet ist. Trägt schon ein Baustein den Namen, hat der Verein
 * entschieden: übersprungen.
 */
function provisionMailBody(tx: DbOrTx, deps: Deps, ctx: CallContext, locale: string): void {
  provisionOnce(tx, deps, { module: 'dms', kind: 'snippet', key: 'mailBody' }, () => {
    const text = MAIL_BODY_DEFAULTS[locale] ?? MAIL_BODY_DEFAULTS.de!;
    if (tx.select({ id: documentSnippets.id }).from(documentSnippets).where(eq(documentSnippets.name, text.name)).get()) return 'skipped';
    const id = newId();
    tx.insert(documentSnippets).values({ id, name: text.name, subject: null, body: text.body, sortOrder: 0, isActive: true }).run();
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.create', entityType: 'documentSnippet', entityId: id, after: { name: text.name, subject: null }, params: { name: text.name } });
    writeSettingInternal(tx, deps, ctx, 'dms.mail.defaultBodySnippetId', id, 'dms.install.setting');
    return 'created';
  });
}

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
  const locale = deps.locales()[0] ?? 'de';
  provisionMailBody(tx, deps, ctx, locale);
  if (tx.select().from(documentTypes).get()) return;

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

  writeSettingInternal(tx, deps, ctx, 'dms.defaultTypeIncoming', DEFAULT_TYPE_INCOMING, 'dms.install.setting');
  writeSettingInternal(tx, deps, ctx, 'dms.defaultTypeOutgoing', DEFAULT_TYPE_OUTGOING, 'dms.install.setting');

  // Eine englische Installation bekommt englische Beschriftungen; die Vorgabe
  // der Definition bleibt deutsch — sie gilt für Installationen, die vor dieser
  // Einstellung eingerichtet wurden.
  const channelLabels: Record<string, Record<string, string>> = {
    en: { post: 'Post', registeredMail: 'Registered mail', email: 'E-mail', inPerson: 'Handed over', portal: 'Portal', other: 'Other' },
  };
  const labelsFor = channelLabels[locale];
  if (labelsFor) {
    writeSettingInternal(
      tx, deps, ctx, 'dms.dispatchChannels',
      DEFAULT_DISPATCH_CHANNELS.map((c) => ({ key: c.key, label: labelsFor[c.key] ?? c.label })),
      'dms.install.setting',
    );
  }

  recordAudit(tx, deps, ctx, {
    action: 'dms.install',
    entityType: 'module',
    entityId: 'dms',
    after: { documentTypes: starters.map((type) => type.key) },
    // Die Namen der beiden Arten zum Zeitpunkt (Nutzdaten, der Verein darf sie umbenennen; Designer 2026-10-09).
    params: { incomingLabel: labels.incoming, outgoingLabel: labels.outgoing },
  });
}
