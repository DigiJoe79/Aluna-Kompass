export const CORE_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'modules.manage',
  'audit.view',
  'documents.create',
  'documents.view',
  'media.upload',
  // Die Projekte liegen im Kern und trugen bis zum Cutover die Rechte des
  // Webseiten-Moduls. Ohne dieses Modul gäbe es sie sonst nicht mehr.
  'projects.view',
  'projects.manage',
  'backup.export',
  'backup.import',
] as const;

export type CorePermission = (typeof CORE_PERMISSIONS)[number];
