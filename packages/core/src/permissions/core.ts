export const CORE_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'modules.manage',
  'audit.view',
  'documents.create',
  'documents.view',
  'media.upload',
  'backup.export',
  'backup.import',
] as const;

export type CorePermission = (typeof CORE_PERMISSIONS)[number];
