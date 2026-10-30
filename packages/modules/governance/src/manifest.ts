import { defineModule, type ModuleManifest } from '@kompass/core';
import { registerAssemblyResultSource, registerAuditorCandidateSource, registerAuditResolutionSource, registerResolutionFactsSource, registerStatuteSource } from '@kompass/module-finance';
import { governedAssemblyInternal } from './finance-sources/assembly';
import { auditResolutionsInternal } from './finance-sources/audit-resolutions';
import { auditorCandidatesInternal } from './finance-sources/auditors';
import { resolutionFactsInternal } from './finance-sources/resolutions';
import { statuteSuggestionInternal } from './finance-sources/statute';
import { GOVERNANCE_DASHBOARD_TILES } from './dashboard';
import { installGovernance } from './install';
import { governanceDocumentTemplates } from './invitation/template';
import { minutesPrintTemplates } from './minutes/template';
import { attachmentTemplates } from './minutes/attachment-templates';
import { GOVERNANCE_MCP_TOOLS } from './mcp-tools';
import { governanceRecordDeleted } from './record-deleted';
import { governanceRecordLabels } from './record-labels';
import { termOwnsRoleRowInternal } from './role-rows';
import { governanceRecordReferences } from './record-references';
import { governanceRetentionHolds } from './retention';
import { seedGovernance } from './seed';
import { GOVERNANCE_SETTINGS } from './settings';

// Quellen der Finanzen (G7): Gremien liefert, die Finanzen kennen Gremien nicht. Jede Quelle prüft selbst, ob Gremien
// eingeschaltet ist.
registerAssemblyResultSource(governedAssemblyInternal);
registerAuditorCandidateSource(auditorCandidatesInternal);
registerStatuteSource(statuteSuggestionInternal);
registerResolutionFactsSource(resolutionFactsInternal);
// Kassenprüfung, Abschnitt 9 (G-30): die finanzwirksamen Beschlüsse des Prüfjahres.
registerAuditResolutionSource(auditResolutionsInternal);

/**
 * Gremien: Organe, Ämter, Amtsinhaberschaften und die Satzung mit Regelwerk (Spec Gremien § 3, § 4). Setzt Mitglieder
 * voraus (Anwesenheit, Stimmrecht und Beschlussfähigkeit hängen am Mitgliederstand) und damit Finanzen.
 */
export const governanceModule: ModuleManifest = defineModule({
  key: 'governance',
  version: '0.1.0',
  permissions: ['governance.read', 'governance.manage', 'governance.record'],
  dependsOn: ['contacts', 'dms', 'finance', 'members'],
  // Designer Phase 1 (N1, N7, Freigabe Joe 2026-10-28): Bereich „Gremien“ nach Finanzen, Mitlauf als Arbeitsfläche.
  moduleIcon: 'landmark',
  // Reihenfolge des Boards Phase 2 (Plan U2).
  navigation: [
    { key: 'governance.overview', href: '/governance', icon: 'landmark', group: 'governance', permission: 'governance.read' },
    { key: 'governance.meetings', href: '/governance/meetings', icon: 'landmark', group: 'governance', permission: 'governance.read' },
    { key: 'governance.resolutions', href: '/governance/resolutions', icon: 'landmark', group: 'governance', permission: 'governance.read' },
    { key: 'governance.circulars', href: '/governance/circulars', icon: 'landmark', group: 'governance', permission: 'governance.read' },
    { key: 'governance.statutes', href: '/governance/statutes', icon: 'landmark', group: 'governance', permission: 'governance.read' },
    { key: 'governance.register', href: '/governance/register', icon: 'landmark', group: 'governance', permission: 'governance.read' },
  ],
  workspaceRoutes: ['/governance/meetings/*/live'],
  adminNavigation: [{ key: 'governance.admin', href: '/admin/governance', icon: 'landmark', permission: 'governance.manage' }],
  help: [
    { href: '/governance/statutes/*/rules', doc: 'gremien/satzung-und-regelwerk' },
    { href: '/governance/statutes', doc: 'gremien/satzung-und-regelwerk' },
    { href: '/governance/resolutions', doc: 'gremien/beschluesse' },
    { href: '/governance/circulars', doc: 'gremien/umlauf' },
    { href: '/governance/register', doc: 'gremien/register' },
    { href: '/governance/organs', doc: 'gremien/uebersicht' },
    { href: '/governance/meetings/*/live', doc: 'gremien/mitlauf' },
    { href: '/governance/meetings', doc: 'gremien/sitzungen' },
    { href: '/admin/governance', doc: 'gremien/einstellungen' },
    { href: '/governance', doc: 'gremien/uebersicht' },
  ],
  settings: GOVERNANCE_SETTINGS,
  // Kassenprüfung (Spec § 3.4): Die Rolle folgt aus der Amtsinhaberschaft; den Halter bringt die Inhaberschaft.
  contactRoles: [{ key: 'auditor', retention: 'none', managedBy: 'governance' }],
  // Vorstand und Schatzmeister definieren die Finanzen; solange Gremien eingeschaltet ist, folgen sie den Ämtern (Spec § 3.4).
  managesContactRoles: ['board-member', 'treasurer'],
  // … aber nur die Zeilen, die eine Amtszeit trägt; Zeilen von vor Gremien bleiben in Kontakten beendbar (V-1).
  ownsContactRoleRow: (deps, rowId) => termOwnsRoleRowInternal(deps.db, rowId),
  // Einladungen, Anwesenheitslisten, Vorstandsprotokolle (Spec § 9.1).
  documentAreas: [{ key: 'governance', permission: 'governance.read' }],
  // Einladungen und Briefe hängen an der Sitzung (Plan G2): wer Gremien lesen darf, liest sie über die Seiten des Moduls.
  // Umläufe nehmen Nachweise auf (Mail, Bildschirmfoto); Beschlüsse sind Belege anderer Vorgänge (Plan G3).
  linkedDocumentAccess: [
    { entityType: 'governanceMeeting', readPermission: 'governance.read', receivePermission: 'governance.manage' },
    { entityType: 'governanceCircular', readPermission: 'governance.read', receivePermission: 'governance.manage' },
    { entityType: 'governanceResolution', readPermission: 'governance.read' },
    // Registeranmeldung (Plan G5): Zwischenverfügungen, Registerauszug, Bestätigung des Transparenzregisters.
    { entityType: 'governanceRegisterFiling', readPermission: 'governance.read', receivePermission: 'governance.manage' },
  ],
  install: installGovernance,
  // Einladung und Briefe je Mitglied (Plan G2) auf dem Briefkopf; Protokollentwurf (Plan G4) als Bericht.
  documentTemplates: [...governanceDocumentTemplates, ...minutesPrintTemplates, ...attachmentTemplates],
  documentBases: ['a4-mit-briefkopf', 'a4-plain-slim'],
  mcpTools: GOVERNANCE_MCP_TOOLS,
  // Fristen der Gremien (Spec § 11), Vorgabe aus bis U1.
  dashboardTiles: GOVERNANCE_DASHBOARD_TILES,
  retentionHolds: governanceRetentionHolds,
  recordLabels: governanceRecordLabels,
  recordDeleted: governanceRecordDeleted,
  recordReferences: governanceRecordReferences,
  seed: seedGovernance,
  /** Aktionen des Änderungsprotokolls (Spec § 10): Personen nur als `…ContactId`, nie Namen. */
  auditActions: {
    'governance.install.organs': { params: [] },
    'governance.organ.create': { params: ['kind'] },
    'governance.organ.update': { params: ['kind'] },
    'governance.organ.activate': { params: ['kind'] },
    'governance.organ.deactivate': { params: ['kind'] },
    /** Der Name des Amts ist die Entität. */
    'governance.office.create': { params: [] },
    'governance.office.update': { params: [] },
    'governance.office.activate': { params: [] },
    'governance.office.deactivate': { params: [] },
    'governance.term.start': { params: ['origin', 'since', 'contactId'] },
    'governance.term.end': { params: ['until', 'reason', 'contactId'] },
    /** Zahl der übernommenen Rollenzeilen. */
    'governance.term.adopt': { params: ['count'] },
    'governance.statute.create': { params: [] },
    /** Feldnamen kommagetrennt — keine Werte. */
    'governance.statute.update': { params: ['fields'] },
    /** G-5: Regelwerk eines eingetragenen oder abgelösten Stands; Grund und betroffene Nummern stehen in `after`. */
    'governance.statute.rulesAmend': { params: ['fields', 'affected'] },
    'governance.statute.register': { params: ['registeredOn'] },
    'governance.statute.delete': { params: [] },
    'governance.meeting.create': { params: ['kind', 'heldOn'] },
    /** Feldnamen kommagetrennt — keine Werte. */
    'governance.meeting.update': { params: ['kind', 'heldOn', 'fields'] },
    'governance.meeting.delete': { params: ['kind', 'heldOn'] },
    /** Der Grund steht nur am Datensatz. */
    'governance.meeting.cancel': { params: ['kind', 'heldOn', 'cancelledOn'] },
    'governance.agenda.save': { params: ['kind', 'position'] },
    'governance.agenda.remove': { params: ['kind'] },
    'governance.agenda.reorder': { params: ['count'] },
    'governance.agenda.propose': { params: ['count'] },
    'governance.agenda.note': { params: ['position'] },
    'governance.motion.save': { params: ['meetingId', 'receivedOn', 'late'] },
    /** Der Kontakt der antragstellenden Person wurde gelöscht; der Antrag bleibt ohne Bezug. */
    'governance.motion.contactRemoved': { params: [] },
    'governance.assemblyRequest.save': { params: ['receivedOn', 'supporters', 'reached'] },
    /** Nummer des Hauptdokuments. */
    'governance.invitationRun.start': { params: ['kind', 'meetingId', 'documentNumber'] },
    'governance.invitationRun.continue': { params: ['issued', 'refused'] },
    /** Je Brief, ohne Namen. */
    'governance.invitation.letter': { params: ['documentNumber'] },
    'governance.invitation.mail': { params: ['count'] },
    'governance.invitation.markPost': { params: ['count', 'sentOn'] },
    'governance.invitation.toPost': { params: ['count'] },
    'governance.invitation.toEmail': { params: ['count'] },
    'governance.boardInvitation.issue': { params: ['heldOn', 'documentNumber'] },
    'governance.boardInvitation.mail': { params: ['count'] },
    /** Weg der Einladung steht nur am Datensatz. */
    'governance.invitation.note': { params: ['invitedOn'] },
    'governance.meeting.start': { params: ['kind', 'heldOn'] },
    'governance.meeting.takeOver': { params: ['kind', 'heldOn'] },
    'governance.meeting.end': { params: ['kind', 'heldOn', 'endedAt'] },
    'governance.meeting.reopen': { params: [] },
    'governance.attendance.prefill': { params: ['count'] },
    /** Gäste ohne Kontakt: `contactId` leer. */
    'governance.attendance.save': { params: ['role', 'contactId'] },
    'governance.attendance.arrive': { params: ['at', 'contactId'] },
    'governance.attendance.leave': { params: ['at', 'contactId'] },
    /** Der Kontakt wurde gelöscht; Stimmrecht und Zeiten bleiben. */
    'governance.attendance.contactRemoved': { params: [] },
    /** Feldnamen kommagetrennt — keine Werte, keine Begründungen. */
    'governance.findings.save': { params: ['fields'] },
    /** Antragstext nur am Datensatz. */
    'governance.resolution.save': { params: ['kind', 'agendaItemId'] },
    /** Die Begründung einer Feststellung gegen die Zählung steht nur am Datensatz. */
    'governance.resolution.decide': { params: ['kind', 'outcome', 'againstCount'] },
    'governance.election.round': { params: ['officeId', 'round'] },
    'governance.election.accept': { params: ['officeId', 'contactId', 'acceptedOn', 'declined'] },
    /** L-2: Ein korrigierter Wahlgang — die Erklärung einer nicht mehr Gewählten entfällt; sie steht in `before`. */
    'governance.election.declarationDropped': { params: ['officeId', 'contactId'] },
    /** Antragstext nur am Datensatz. */
    'governance.circular.create': { params: ['kind', 'organId'] },
    /** Vermerk und Nachweis nur am Datensatz. */
    'governance.circular.response': { params: ['answer', 'contactId'] },
    'governance.circular.decide': { params: ['kind', 'outcome', 'againstCount'] },
    /** Der Kontakt wurde gelöscht; die Antwort bleibt ohne Bezug. */
    'governance.circular.contactRemoved': { params: [] },
    /** Nummer des Dokuments — keine Namen. */
    'governance.minutes.attendanceList': { params: ['documentNumber'] },
    /** Nummer und Zahl der Personen — kein Geburtsdatum, kein Ort. */
    'governance.minutes.registerData': { params: ['documentNumber', 'count'] },
    'governance.minutes.file': { params: ['documentNumber', 'version'] },
    'governance.minutes.attach': { params: ['documentNumber'] },
    /** G-13: Fassung vor dem Festschreiben ersetzt (Dokument storniert); der Grund steht in `after` und am Dokument. */
    'governance.minutes.replace': { params: ['documentNumber', 'version'] },
    /** Abgleich beim Festschreiben: Die bestehende Inhaberschaft bekommt den Beschluss. */
    'governance.term.link': { params: ['acceptedOn', 'contactId'] },
    'governance.statute.resolve': { params: ['on'] },
    'governance.registerOccasion.record': { params: ['kind', 'occurredOn'] },
    'governance.registerOccasion.withdraw': { params: ['kind', 'occurredOn'] },
    'governance.resolution.number': { params: ['kind', 'number'] },
    /** Zahl der nummerierten Beschlüsse und begonnenen Amtsinhaberschaften. */
    'governance.meeting.seal': { params: ['kind', 'heldOn', 'resolutions', 'terms'] },
    'governance.circular.seal': { params: ['kind', 'number'] },
    'governance.meeting.backfill': { params: ['kind', 'heldOn', 'present', 'voting'] },
    'governance.meeting.backfillCorrect': { params: ['kind', 'heldOn', 'fields'] },
    /** Der Grund steht nur am Datensatz. */
    'governance.minutes.correct': { params: ['documentNumber', 'version'] },
    /** Registeranmeldung (Plan G5): Zahl der Anlässe, Feldnamen ohne Werte. */
    'governance.register.create': { params: ['occasions'] },
    'governance.register.addOccasions': { params: ['count'] },
    'governance.register.update': { params: ['fields'] },
    'governance.register.interimOrder': { params: ['on', 'deadline'] },
    'governance.register.interimResolved': { params: ['resolvedOn'] },
    /** Schlüssel der Prüfliste und Zahl der Dokumente — keine Nummern, keine Betreffs. */
    'governance.register.documents': { params: ['key', 'count'] },
    /** Ergebnis der Prüffragen und Tag; die Antworten stehen als Wahrheitswerte im Vorher/Nachher. */
    'governance.register.transparency': { params: ['result', 'checkedOn'] },
    /** Zahl der Anlässe und der eingetragenen Satzungsstände; Gericht und Nummer protokolliert der Vereinsstamm. */
    'governance.register.complete': { params: ['registeredOn', 'occasions', 'statutes'] },
    /** Feldnamen kommagetrennt; die Tage stehen im Vorher/Nachher. */
    'governance.register.dissolution': { params: ['fields'] },
    /** Der Kontakt des Notars wurde gelöscht; die Anmeldung bleibt ohne Bezug. */
    'governance.register.notaryRemoved': { params: [] },
  },
  /** Spec § 9.3: Organe, Ämter, Inhaberschaften und beschlossene Stände sind rechenschaftsrelevant. */
  deletionRules: [
    { entity: 'governanceStatute', deletable: true, reason: 'Ein Entwurf ohne Beschluss ist Arbeitsmaterial.', guard: 'nur im Zustand Entwurf', auditAction: 'governance.statute.delete' },
    { entity: 'governanceMeeting', deletable: true, reason: 'Eine geplante Sitzung ohne Einladung ist Arbeitsmaterial.', guard: 'nur im Zustand geplant, ohne Einladung, Anträge und Dokumente', auditAction: 'governance.meeting.delete' },
    { entity: 'governanceOrgan', deletable: false, reason: 'Rechenschaft: Sitzungen und Ämter hängen daran; archivieren statt löschen.' },
    { entity: 'governanceOffice', deletable: false, reason: 'Rechenschaft: Amtsinhaberschaften hängen daran; archivieren statt löschen.' },
    { entity: 'governanceTerm', deletable: false, reason: 'Rechenschaft: Wer wann im Amt war, zählt für Haftung, Register und Entlastung.' },
    { entity: 'governanceRegisterOccasion', deletable: true, reason: 'Ein offener Anlass ist eine Aufgabe, keine Spur: Schaltet ein Amt „vertritt“ am selben Tag zurück, ist nichts anzumelden.', guard: 'nur Anlass „Vertretungsregel“ desselben Tags ohne Anmeldung, beim Zurückschalten des Amts', auditAction: 'governance.registerOccasion.withdraw' },
    { entity: 'governanceRegisterFiling', deletable: false, reason: 'Rechenschaft: Registeranmeldungen belegen, was wann beim Registergericht angemeldet und eingetragen wurde.' },
  ],
});
