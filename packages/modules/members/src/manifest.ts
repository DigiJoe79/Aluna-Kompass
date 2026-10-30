import { defineModule, type ModuleManifest } from '@kompass/core';
import { memberMemberships } from './schema';
import { MEMBERS_DASHBOARD_TILES } from './dashboard';
import { membersDirectDebitSources } from './direct-debit-source';
import { membersDirectDebitWaive } from './fees';
import { membersMandateUsages } from './fee-agreement';
import { installMembers } from './install';
import { memberLetterTemplates } from './letters/templates';
import { MEMBERS_MCP_TOOLS } from './mcp-tools';
import { membersRecordLabels } from './record-labels';
import { membersRecordDeleted, membersRetentionDue, membersRetentionHolds } from './retention';
import { seedMembers } from './seed';
import { membersSetTranslations, membersTranslatables } from './translations';
import { MEMBERS_SETTINGS } from './settings';

/**
 * Mitglieder: Mitgliedsarten und Mitgliedschaften auf Kontakten (Spec Mitglieder und Lastschrift § 2, § 3). Setzt
 * Finanzen voraus (Entscheid F1): Das Beitragssoll sind offene Posten, ein Verein ohne Finanzen hat keines.
 */
export const membersModule: ModuleManifest = defineModule({
  key: 'members',
  version: '0.1.0',
  permissions: ['members.read', 'members.manage', 'members.fees'],
  dependsOn: ['contacts', 'finance', 'dms'],
  // Handoff Mitglieder 2 (N2, Joe 2026-10-18): Schiene „Mitglieder“ mit Zweitebene „Mitglieder · Beiträge“.
  navigation: [
    { key: 'members.list', href: '/members', icon: 'users', group: 'members', permission: 'members.read' },
    { key: 'members.fees', href: '/members/fees', icon: 'users', group: 'members', permission: 'members.read' },
  ],
  adminNavigation: [{ key: 'members.admin', href: '/admin/members', icon: 'users', permission: 'members.fees' }],
  help: [
    { href: '/members/new', doc: 'mitglieder/mitglied-aufnehmen' },
    { href: '/members/fees', doc: 'mitglieder/beitraege-und-mahnungen' },
    { href: '/members', doc: 'mitglieder/mitglieder' },
    { href: '/admin/members', doc: 'mitglieder/einstellungen' },
  ],
  settings: MEMBERS_SETTINGS,
  // Läuft von Eintritt bis Ende der Mitgliedschaft und hält nicht selbst: Den Halter bringt die Mitgliedschaft (§ 3.2).
  contactRoles: [{ key: 'member', retention: 'none', managedBy: 'members' }],
  // Antrag, Bestätigungen, Mahnungen: nur wer Mitglieder lesen darf (Spec § 5).
  documentAreas: [{ key: 'members', permission: 'members.read' }],
  // F7 (Joe 2026-10-19): Unversandte Briefe storniert die Akte wie andere Dokumente; Mahnstufe, Überweisungsaufforderung
  // und Ankündigung übergehen stornierte Dokumente.
  voidableDocumentTypes: ['member-admission', 'member-resignation', 'member-rejection', 'member-reminder', 'member-fee-notice'],
  // Briefe hängen an der Mitgliedschaft (Plan M4): wer Mitglieder lesen darf, liest sie über die Seiten des Moduls.
  linkedDocumentAccess: [{ entityType: 'membership', readPermission: 'members.read' }],
  install: installMembers,
  // Briefe der Mitgliedschaft (Plan M4): alle auf dem Briefkopf.
  documentTemplates: memberLetterTemplates,
  documentBases: ['a4-mit-briefkopf'],
  // Beiträge sind offene Posten der Finanzen mit dieser Herkunft (Spec § 6.1); Beschriftung über `recordLabels`.
  openItemOrigins: [{ type: 'memberFeeCharge' }],
  // Plan L1: Mitgliedschaften mit Zahlweg Lastschrift stehen am Mandat unter „wofür“.
  mandateUsages: membersMandateUsages,
  // Plan L2: offene Beiträge mit Lastschrift kommen so in die Vorschau des Einzugs.
  directDebitSources: membersDirectDebitSources,
  directDebitWaive: membersDirectDebitWaive,
  mcpTools: MEMBERS_MCP_TOOLS,
  // Handoff 2.8: Rückstände, offene Anträge, Beiträge des Jahres.
  dashboardTiles: MEMBERS_DASHBOARD_TILES,
  seed: seedMembers,
  /**
   * Aktionen des Änderungsprotokolls (Spec § 8): Mitglieder nennen ihre Nummer als Wert, nie den Namen; Personen nur
   * als `…ContactId`.
   */
  auditActions: {
    'members.type.create': { params: ['key'] },
    'members.type.update': { params: ['key'] },
    'members.type.activate': { params: ['key'] },
    'members.type.deactivate': { params: ['key'] },
    'members.type.reorder': { params: [] },
    'members.type.delete': { params: ['key'] },
    'members.numbers.setNext': { params: ['next'] },
    'members.membership.apply': { params: [] },
    'members.membership.admit': { params: ['memberNumber'] },
    'members.membership.reject': { params: [] },
    'members.membership.changeType': { params: ['memberNumber', 'typeKey'] },
    'members.membership.resign': { params: ['memberNumber', 'endsOn'] },
    'members.membership.end': { params: ['memberNumber', 'reason', 'endsOn'] },
    /** M10: mit der Zahl der stornierten, nicht versandten Austrittsbestätigungen. */
    'members.membership.revokeEnd': { params: ['memberNumber', 'voided'] },
    'members.membership.delete': { params: ['memberNumber'] },
    /** Nur die Zahl der Zeilen — kein Filtertext, keine Namen. */
    'members.export': { params: ['count'] },
    'members.feeSchedule.create': { params: ['validFrom'] },
    'members.feeSchedule.update': { params: ['validFrom'] },
    'members.feeSchedule.delete': { params: ['validFrom'] },
    /** Kein Betrag, kein Grund: Härtefälle sind vertraulich (Spec § 4.2). */
    'members.feeAgreement.set': { params: ['memberNumber', 'validFrom'] },
    /** Nur Jahr und Zahl — jeden Posten protokollieren die Finanzen selbst. */
    'members.feeRun.start': { params: ['year', 'count'] },
    'members.feeRun.finish': { params: ['year', 'count'] },
    'members.fees.recalculate': { params: ['memberNumber', 'replaced', 'added'] },
    /** Plan N1 E3: Zahl der Beiträge, deren Zahlweg mit der Vereinbarung wechselte. */
    'members.fees.paymentMethod': { params: ['memberNumber', 'count'] },
    'members.fee.defer': { params: ['memberNumber', 'dueOn'] },
    'members.fee.waive': { params: ['memberNumber'] },
    /** Art als Code, Nummer des Dokuments — nie Betreff oder Empfänger. */
    'members.letter.issue': { params: ['memberNumber', 'kind', 'documentNumber'] },
    'members.countCertificate.issue': { params: ['countedOn', 'count', 'documentNumber'] },
    /** Lauf als Art (`feeRun`, `dunningRun`), Zahl der Briefe — keine Namen. */
    'members.run.mail': { params: ['kind', 'count'] },
    'members.run.markPost': { params: ['kind', 'count', 'sentOn'] },
    'members.run.toPost': { params: ['kind', 'count'] },
    'members.run.toEmail': { params: ['kind', 'count'] },
    'members.install.setting': { params: ['key'] },
    /** Einstellung der Mitglieder geändert (Kündigungsfrist, Eintrittsjahr, Zahlungsziel, Mahnstufen). */
    'members.setting.set': { params: ['key'] },
    /** Stichtag und Zahl der Briefe — keine Namen, keine Nummern. */
    'members.dunningRun.start': { params: ['asOfOn', 'count'] },
    'members.dunningRun.finish': { params: ['asOfOn', 'count'] },
  },
  retentionHolds: membersRetentionHolds,
  retentionDue: membersRetentionDue,
  recordDeleted: membersRecordDeleted,
  // I-A: Ausgeschaltet schwiege das Modul als Halter und bei `recordDeleted` — jede Mitgliedschaft (auch beendet oder
  // abgelehnt) trägt Personenbezug und eine Frist, deshalb bleibt es an, solange es eine gibt.
  canDisable: (deps) => (deps.db.select({ id: memberMemberships.id }).from(memberMemberships).limit(1).get() ? 'hasMemberships' : null),
  recordLabels: membersRecordLabels,
  translatables: membersTranslatables,
  setTranslations: membersSetTranslations,
  deletionRules: [
    {
      entity: 'membership',
      deletable: true,
      reason: 'Personenbezogene Mitgliedsdaten; die Beiträge bleiben als Finanzdaten.',
      guard: 'erst wenn die Frist nach Austritt bzw. Ablehnung abgelaufen ist (retentionDue); ein offener Antrag sofort, weil er irrtümlich angelegt sein kann',
      auditAction: 'members.membership.delete',
    },
    {
      entity: 'memberFeeSchedule',
      deletable: true,
      reason: 'Ein Stand der Beitragsordnung, nach dem noch kein Beitrag angelegt ist, ist ein Entwurf.',
      guard: 'nur, solange nach ihm kein Beitrag angelegt ist und er nicht der einzige Stand ist',
      auditAction: 'members.feeSchedule.delete',
    },
    {
      entity: 'memberType',
      deletable: true,
      reason: 'Stammdaten des Vereins. Rechenschaftsrelevant ist der Verlauf an den Mitgliedschaften, nicht die unbenutzte Art.',
      guard: 'nur, solange die Art an keiner Mitgliedschaft stand (sonst deaktivieren)',
      auditAction: 'members.type.delete',
    },
  ],
});
