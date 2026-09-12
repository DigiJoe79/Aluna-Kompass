export const CORE_PERMISSIONS = [
  'users.manage',
  'roles.manage',
  'settings.manage',
  'modules.manage',
  'audit.view',
  // Der Fristenbildschirm sammelt über alle Module; er braucht ein eigenes
  // Recht, weil er zeigt, welche personenbezogenen Daten zur Löschung anstehen.
  'retention.view',
  // Der Auszugsweg der Pipeline (Ad-hoc, `filed: false`) bleibt im Kern; die
  // Akte selbst — Ablage, Nummernvergabe, Storno — lebt im Modul `dms`.
  'documents.export',
  'media.upload',
  // Wiedervorlagen hängen an Vorgängen aller Module; die Liste auf der
  // Startseite zeigt Anlässe, keine Inhalte — deshalb ein eigenes Leserecht.
  'followUps.view',
  'followUps.manage',
  'backup.export',
  'backup.import',
] as const;

export type CorePermission = (typeof CORE_PERMISSIONS)[number];
