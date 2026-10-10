import { defineModule, type ModuleManifest } from '@kompass/core';
import { ANIMALS_DASHBOARD_TILES } from './dashboard';
import { animalsMediaReferences } from './references';
import { animalsRecordLabels } from './record-labels';
import { seedAnimals } from './seed';
import { ANIMALS_SETTINGS } from './settings';
import { animalsSetTranslations, animalsTranslatables } from './translations';
import { publishedAnimals } from './views';
import { ANIMALS_MCP_TOOLS } from './mcp-tools';
import { sweepProposals } from './proposals/cleanup';
import { animalProfileTemplate, PROFILE_BASE } from './print/template';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage', 'animals.propose'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  adminNavigation: [{ key: 'animals.admin', href: '/admin/animals', icon: 'paw-print', permission: 'settings.manage' }],
  help: [
    { href: '/animals/proposals', doc: 'tiere-vorschlaege' },
    { href: '/animals', doc: 'tiere' },
    { href: '/admin/animals', doc: 'einstellungen/tiere-einrichten' },
  ],
  settings: ANIMALS_SETTINGS,
  /** Zwischenablage der Bilder von Vorschlägen (`deps.files('animals')`); das Backup sichert sie mit. */
  files: true,
  /** Zwischenablage nach 24 Stunden, Inhalte entschiedener Vorschläge nach 90 Tagen (Spec Vorschlags-Eingang § 7). */
  housekeeping: (deps) => sweepProposals(deps).then(() => undefined),
  documentTemplates: [animalProfileTemplate],
  // Führt eine Installation eigene Basen, meldet `documentBaseGaps`, wenn diese fehlt.
  documentBases: [PROFILE_BASE],
  /** Aktionen des Änderungsprotokolls (Spec Protokoll § 3); der Name des Hundes ist Nutzdatum. */
  auditActions: {
    'animals.create': { params: ['name'] },
    'animals.update': { params: ['name'] },
    'animals.setStatus': { params: ['name', 'status'] },
    'animals.setPhotos': { params: ['name'] },
    'animals.setStory': { params: ['name'] },
    'animals.publish': { params: ['name'] },
    'animals.unpublish': { params: ['name'] },
    /** `viaMcp`: beim Schreiben über MCP von selbst vorgemerkt, sonst von Hand angefordert. */
    'animals.requestReview': { params: ['name', 'viaMcp'] },
    'animals.confirmReview': { params: ['name'] },
    'animals.delete': { params: ['name'] },
    /** Vorschlags-Eingang (Spec § 7): `kind` ist die Art, `name` der Hund (bei neuem Hund der vorgeschlagene Name). */
    'animals.proposal.submit': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.replace': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.withdraw': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.accept': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.acceptWithChanges': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.reject': { params: ['kind', 'name', 'sourceKey'] },
    'animals.proposal.stageImage': { params: [] },
    /** Ein Eintrag je Aufräumdurchlauf mit Wirkung: geleerte Vorschläge, gelöschte Bilder. */
    'animals.proposal.clear': { params: ['proposals', 'images'] },
  },
  deletionRules: [
    {
      entity: 'animal',
      deletable: true,
      reason: 'Webseiteninhalt. Rechenschaftsrelevant sind die Vorgänge, die an einem Tier hängen, nicht das Profil.',
      guard: 'nur zurückgezogen; nur solange kein Halter läuft (retentionHolds) und nichts mehr auf das Tier zeigt (recordReferences)',
      auditAction: 'animals.delete',
    },
    {
      entity: 'animalProposal',
      deletable: false,
      reason:
        'Arbeitsmaterial mit Rückkanal: Der Vorschlag bleibt mit Zustand, Zeitpunkt und Grund; Werte, Zweifelsfälle, Stand beim Vorschlag und Endfassung werden 90 Tage nach der Entscheidung geleert (Spec Vorschlags-Eingang § 7).',
    },
    {
      entity: 'animalProposalImage',
      deletable: true,
      reason: 'Zwischenablage, kein Bestand: Was angenommen wird, liegt danach in der Mediathek.',
      guard: 'bereitgestellt ohne Vorschlag nach 24 Stunden; Dateien entschiedener Vorschläge sofort; Bildangaben 90 Tage nach der Entscheidung',
      auditAction: 'animals.proposal.clear',
    },
    {
      entity: 'animalOrigin',
      deletable: true,
      reason: 'Verknüpfung eines Tiers mit seinem Eintrag bei einer Quelle; ohne das Tier ohne Sinn.',
      guard: 'nur mit dem Tier (deleteAnimal)',
      auditAction: 'animals.delete',
    },
  ],
  publishedViews: [publishedAnimals],
  mcpTools: ANIMALS_MCP_TOOLS,
  mediaReferences: animalsMediaReferences,
  recordLabels: animalsRecordLabels,
  translatables: animalsTranslatables,
  setTranslations: animalsSetTranslations,
  seed: seedAnimals,
  dashboardTiles: ANIMALS_DASHBOARD_TILES,
});
