import { CORE_AUDIT_ACTIONS } from './audit/actions';
import { coreRecordLabels } from './audit/record-labels';
import { checkBackupHealth, isAppDeps, runBackupSchedule } from './backup/schedule';
import { CORE_DASHBOARD_TILES } from './dashboard/tiles';
import { CORE_DELETION_RULES } from './deletion-policy';
import { coreRecordReferences } from './deletion-guards';
import { coreMediaReferences } from './media/references';
import { defineModule } from './modules/manifest';
import { publishedAiLabeling } from './published/ai-labeling';
import { publishedOrganization } from './published/organization';
import { CORE_PERMISSIONS } from './permissions/core';
import { CORE_SETTINGS } from './settings/core';

export const coreModule = defineModule({
  key: 'core',
  version: '0.1.0',
  permissions: CORE_PERMISSIONS,
  settings: CORE_SETTINGS,
  publishedViews: [publishedOrganization, publishedAiLabeling],
  mediaReferences: coreMediaReferences,
  recordReferences: coreRecordReferences,
  recordLabels: coreRecordLabels,
  deletionRules: CORE_DELETION_RULES,
  auditActions: CORE_AUDIT_ACTIONS,
  dashboardTiles: CORE_DASHBOARD_TILES,
  /**
   * Nächtliches Backup und Wache über die Backups (Spec Backup § Zeitplan, § Meldungen). Der Kern hat keinen
   * Zeitplaner; ein verpasster Lauf wird im nächsten Takt nachgeholt. Ohne laufende App (Skripte, Tests) nichts.
   */
  housekeeping: async (deps) => {
    if (!isAppDeps(deps) || !deps.backupPath) return;
    await runBackupSchedule(deps);
    await checkBackupHealth(deps);
  },
  files: true,
  providedFiles: ['document-templates'],
});
