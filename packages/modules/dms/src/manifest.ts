import { defineModule, type DeletionRule, type ModuleManifest } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { dmsGatePermissions } from './access';
import { DMS_DASHBOARD_TILES } from './dashboard';
import { dmsFollowUpTargets } from './follow-ups';
import { DMS_SETTINGS, installDms } from './install';
import { DMS_MCP_TOOLS } from './mcp-tools';
import { dmsRecordLabels } from './record-labels';
import { dmsRecordReferences } from './record-references';
import { dmsRetentionDue, dmsRetentionHolds } from './retention';
import { documents } from './schema';
import { seedDms } from './seed';
import { letterTemplate } from './templates';
import { bundleIndexTemplate } from './bundle-index';

/** Prinzip 3 für die Akte: Arbeitsmaterial neben dem Dokument ist löschbar, das Dokument selbst erst nach seiner Frist. */
const DMS_DELETION_RULES: readonly DeletionRule[] = [
  {
    entity: 'documentDraft',
    deletable: true,
    reason:
      'Ein Entwurf ist Arbeitsmaterial: keine Nummer, keine Datei, kein Nachweis. Erst das Festschreiben macht ihn rechenschaftsrelevant.',
    guard: 'nur solange phase = draft',
    auditAction: 'dms.draft.delete',
  },
  {
    entity: 'documentFolder',
    deletable: true,
    reason: 'Nur Ordnung, kein Nachweis — wie ein Ordner der Mediathek.',
    guard: 'nur wenn leer (keine Dokumente, keine Unterordner)',
    auditAction: 'dms.folder.delete',
  },
  {
    entity: 'documentLink',
    deletable: true,
    reason: 'Ein Bezug ist eine Zuordnung, kein Vorgang. Falsch gesetzte Bezüge müssen korrigierbar sein.',
    guard: 'keiner',
    auditAction: 'dms.unlink',
  },
  {
    entity: 'documentRule',
    deletable: true,
    reason: 'Eine Regel ist Bedienkomfort, kein Nachweis.',
    guard: 'keiner',
    auditAction: 'dms.rule.delete',
  },
  {
    entity: 'documentRelation',
    deletable: true,
    reason: 'Ein Bezug zwischen zwei Dokumenten ist eine Zuordnung, kein Vorgang — wie documentLink.',
    guard: 'keiner',
    auditAction: 'dms.unrelate',
  },
  {
    entity: 'documentNote',
    deletable: true,
    reason: 'Eine Notiz ist Arbeitsmaterial neben dem Dokument; sie steht nie im PDF, nie im Index, nie in einem Export.',
    guard: 'nur die eigene Notiz, oder mit dms.manage',
    auditAction: 'dms.note.delete',
  },
  {
    entity: 'documentSnippet',
    deletable: true,
    reason: 'Ein Textbaustein ist Bedienkomfort; der Text lebt im Brief, der ihn benutzt hat.',
    guard: 'keiner',
    auditAction: 'dms.snippet.delete',
  },
  {
    // Der Eintrag nennt statutory10Y als längste in der Praxis vorkommende Klasse; maßgeblich ist die Klasse an der Dokumentart.
    entity: 'document',
    deletable: true,
    reason:
      'Personenbezogene Daten sind nach Wegfall des Zwecks zu löschen (DSGVO Art. 17). Die Aufbewahrungsfrist sticht diese Pflicht, solange sie läuft (Entscheidung 10).',
    guard:
      'Erst nach Ablauf der Frist der Dokumentart, gerechnet ab Ablauf des Kalenderjahres von documentDate. Ein Mensch bestätigt jede Löschung.',
    auditAction: 'dms.delete',
    retentionClass: 'statutory10Y',
  },
];

export const dmsModule: ModuleManifest = defineModule({
  key: 'dms',
  version: '0.1.0',
  dependsOn: ['contacts'],
  files: true,
  settings: DMS_SETTINGS,
  install: installDms,
  permissions: ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'],
  documentTemplates: [letterTemplate, bundleIndexTemplate],
  // Zur Laufzeit, nicht fest: Welche Bereichsrechte die Akte öffnen, steht in den
  // Manifesten der anderen Module (Vorarbeiten-Spec V13).
  navigationFor: (deps) => [{ key: 'dms.list', href: '/dms', icon: 'file', group: 'dms', permission: dmsGatePermissions(deps) }],
  adminNavigation: [{ key: 'dms.admin', href: '/admin/dms', icon: 'folder', permission: 'dms.manage' }],
  help: [
    { href: '/dms', doc: 'akte/dokumente-und-ordner' },
    { href: '/dms/receive', doc: 'akte/post-ablegen' },
    { href: '/dms/new', doc: 'akte/brief-schreiben' },
    { href: '/admin/dms', doc: 'einstellungen/akte-einrichten' },
  ],
  retentionHolds: dmsRetentionHolds,
  recordReferences: dmsRecordReferences,
  retentionDue: dmsRetentionDue,
  recordLabels: dmsRecordLabels,
  followUpTargets: dmsFollowUpTargets,
  dashboardTiles: DMS_DASHBOARD_TILES,
  deletionRules: DMS_DELETION_RULES,
  // Ein ausgeschaltetes Modul schweigt als Halter: Kontakte, die nur ein
  // Dokument hält, würden löschbar. Entwürfe zählen nicht — sie halten nichts.
  canDisable: (deps) => (deps.db.select({ id: documents.id }).from(documents).where(eq(documents.phase, 'issued')).get() ? 'hasFinalRecords' : null),
  mcpTools: DMS_MCP_TOOLS,
  seed: seedDms,
});
