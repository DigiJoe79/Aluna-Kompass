export const REQUIRED_SETTINGS = [
  'organization.name',
  'organization.street',
  'organization.postalCode',
  'organization.city',
  'organization.registerCourt',
  'organization.registerNumber',
  'organization.taxNumber',
  'organization.taxOffice',
  'organization.exemptionNoticeType',
  'organization.exemptionNoticeDate',
] as const;

export const ROLE_TARGET = 3;

function filled(key: string, value: unknown): boolean {
  if (key === 'organization.exemptionNoticeType') return typeof value === 'string' && value !== 'none';
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function computeSetupProgress(input: { settings: Record<string, unknown>; roleCount: number; modules: { key: string; enabled: boolean }[] }) {
  const missing = REQUIRED_SETTINGS.filter((key) => !filled(key, input.settings[key]));
  const nonCore = input.modules.filter((m) => m.key !== 'core');
  return {
    settings: { done: REQUIRED_SETTINGS.length - missing.length, total: REQUIRED_SETTINGS.length, missing: [...missing] },
    roles: { done: Math.min(input.roleCount, ROLE_TARGET), total: ROLE_TARGET },
    modules: { done: nonCore.filter((m) => m.enabled).length, total: nonCore.length },
  };
}
