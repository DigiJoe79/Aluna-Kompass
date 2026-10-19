import { createRoleInternal, isoNow, newId, provisionOnce, readLocales, readSetting, recordAudit, writeSettingInternal, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { documentSnippets, ensureDocumentType } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { memberTypes } from './schema';
import type { DunningLevel } from './settings';
import { START_MEMBER_TYPES, startName } from './start-types';

/** Die Briefarten des Moduls (Spec § 5); Präfixe frei gewählt, eindeutig. */
const MEMBER_LETTER_TYPES = [
  { key: 'member-admission', label: 'Aufnahmebestätigung', prefix: 'MAU', retentionClass: 'consent', protectionArea: 'members' },
  { key: 'member-resignation', label: 'Austrittsbestätigung', prefix: 'MAT', retentionClass: 'consent', protectionArea: 'members' },
  { key: 'member-rejection', label: 'Ablehnung eines Aufnahmeantrags', prefix: 'MAB', retentionClass: 'consent', protectionArea: 'members' },
  { key: 'member-reminder', label: 'Beitragsmahnung', prefix: 'MMA', retentionClass: 'consent', protectionArea: 'members' },
  { key: 'member-fee-notice', label: 'Beitragsmitteilung', prefix: 'MBM', retentionClass: 'consent', protectionArea: 'members' },
  { key: 'member-count-certificate', label: 'Bescheinigung über die Mitgliederzahl', prefix: 'MZB', retentionClass: 'permanent', protectionArea: null },
] as const;

/**
 * Grundausstattung. Läuft beim Einschalten und bei jedem Start, je Teil einmal: Was der Verein umbenannt, entzogen
 * oder gelöscht hat, kommt nie zurück.
 */
export function installMembers(tx: DbOrTx, deps: Deps, ctx: CallContext): void {
  createRoleInternal(tx, deps, ctx, {
    module: 'members',
    originKey: 'members:admin',
    name: 'Mitgliederverwaltung',
    description: 'Führt Mitglieder, Beiträge und Mahnungen.',
    // M29: dms.send für den Versand der Läufe per Mail, dms.file für eigene Briefe der Akte (die Briefe des Moduls brauchen es nicht).
    permissions: ['members.read', 'members.manage', 'members.fees', 'contacts.view', 'contacts.manage', 'dms.view', 'dms.create', 'dms.file', 'dms.send'],
  });

  // Modul-eigen: Antrag und Briefe liegen im Schutzbereich `members`; ihre Frist hängt an der Mitgliedschaft (Halter
  // des Moduls, Spec § 3.2). Die Bescheinigung über die Mitgliederzahl nennt keine Namen: ohne Bereich, dauerhaft (§ 5).
  ensureDocumentType(tx, deps, ctx, { module: 'members', key: 'member-application', label: 'Aufnahmeantrag', prefix: 'MAN', defaultDirection: 'incoming', retentionClass: 'consent', owned: true, protectionArea: 'members' });
  for (const type of MEMBER_LETTER_TYPES) ensureDocumentType(tx, deps, ctx, { module: 'members', ...type, defaultDirection: 'outgoing', owned: true });

  // Die drei Arten als ein Vorschlag: nur in eine leere Tabelle, und nur einmal.
  provisionOnce(tx, deps, { module: 'members', kind: 'memberTypes', key: 'start' }, () => {
    if (tx.select({ id: memberTypes.id }).from(memberTypes).get()) return 'skipped';
    const locales = readLocales(deps);
    const now = isoNow(deps.clock);
    START_MEMBER_TYPES.forEach((type, index) => {
      const id = newId();
      tx.insert(memberTypes).values({ id, key: type.key, name: startName(type.name, locales), hasVotingRight: type.hasVotingRight, feeExempt: type.feeExempt, active: true, sortOrder: index + 1, createdAt: now, updatedAt: now }).run();
      recordAudit(tx, deps, ctx, { action: 'members.type.create', entityType: 'memberType', entityId: id, after: { key: type.key }, params: { key: type.key } });
    });
    return 'created';
  });

  provisionDunningTexts(tx, deps, ctx, readLocales(deps)[0] ?? 'de');
}

/**
 * Die Stufentexte der Mahnungen als Textbausteine der Grundausstattung (Sprachtabelle, Prinzip 7) — neutral, ohne Folge
 * nach einer Satzung: Was die Satzung des Vereins vorsieht, schreibt er selbst hinein. Genau einmal je Installation;
 * trägt schon ein Baustein den Namen, nimmt die Stufe ihn.
 */
const DUNNING_TEXTS: Record<string, Record<string, { name: string; body: string }>> = {
  de: {
    reminder: { name: 'Mahnstufe: Erinnerung', body: 'Sicher ist die Zahlung nur in Vergessenheit geraten. Wenn Sie Fragen zu Ihrem Beitrag haben, melden Sie sich gern bei uns.' },
    dunning: { name: 'Mahnstufe: Mahnung', body: 'Bitte begleichen Sie den offenen Betrag innerhalb der genannten Frist. Können Sie den Beitrag zurzeit nicht zahlen, sprechen Sie uns bitte an.' },
    finalDunning: { name: 'Mahnstufe: Letzte Mahnung', body: 'Dies ist unsere letzte Mahnung. Bitte begleichen Sie den offenen Betrag innerhalb der genannten Frist oder sprechen Sie uns an.' },
  },
  en: {
    reminder: { name: 'Dunning level: reminder', body: 'Perhaps the payment simply slipped your mind. If you have any questions about your fee, please get in touch.' },
    dunning: { name: 'Dunning level: dunning letter', body: 'Please settle the open amount within the period stated. If you cannot pay the fee at the moment, please talk to us.' },
    finalDunning: { name: 'Dunning level: final', body: 'This is our final reminder. Please settle the open amount within the period stated or talk to us.' },
  },
};

function provisionDunningTexts(tx: DbOrTx, deps: Deps, ctx: CallContext, locale: string): void {
  provisionOnce(tx, deps, { module: 'members', kind: 'snippet', key: 'dunningTexts' }, () => {
    const texts = DUNNING_TEXTS[locale] ?? DUNNING_TEXTS.de!;
    const locales = readLocales(deps);
    // Namen nur in den gepflegten Sprachen; die Leitsprache bekommt zur Not den deutschen Namen.
    const named = (name: Record<string, string>) => Object.fromEntries(locales.map((l, i) => [l, name[l] ?? (i === 0 ? (name.de ?? '') : '')]).filter(([, v]) => v !== ''));
    const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels').map((level) => ({ ...level, name: named(level.name) }));
    const next = levels.map((level) => {
      const text = texts[level.key];
      if (!text || level.snippetId) return level;
      const existing = tx.select({ id: documentSnippets.id }).from(documentSnippets).where(eq(documentSnippets.name, text.name)).get();
      if (existing) return { ...level, snippetId: existing.id };
      const id = newId();
      tx.insert(documentSnippets).values({ id, name: text.name, subject: null, body: text.body, sortOrder: 0, isActive: true }).run();
      recordAudit(tx, deps, ctx, { action: 'dms.snippet.create', entityType: 'documentSnippet', entityId: id, after: { name: text.name, subject: null }, params: { name: text.name } });
      return { ...level, snippetId: id };
    });
    const written = writeSettingInternal(tx, deps, ctx, 'members.dunningLevels', next, 'members.install.setting');
    if (!written.ok) throw new Error(`members.dunningLevels: ${JSON.stringify(written.error)}`);
    return 'created';
  });
}

