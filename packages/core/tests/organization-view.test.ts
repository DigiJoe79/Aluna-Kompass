import { describe, expect, it } from 'vitest';
import { coreModule, publishedOrganization, setSetting, unwrap } from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const ctx = ctxWith(['settings.manage']);
  for (const [key, value] of Object.entries({
    'organization.name': 'Musterverein e.V.',
    'organization.street': 'Hauptstraße 1',
    'organization.postalCode': '52428',
    'organization.city': 'Jülich',
    'organization.email': 'info@example.org',
    'organization.iban': 'DE02120300000000202051',
    'organization.taxNumber': '203/5711/0815',
  })) {
    unwrap(await setSetting(deps, ctx, { key, value }));
  }
  return deps;
};

describe('published organization view', () => {
  it('is part of the core module, so every template has it without asking', () => {
    expect(coreModule.publishedViews?.some((v) => v.name === 'organization')).toBe(true);
  });

  it('carries what an imprint needs', async () => {
    const deps = await setup();
    const [row] = publishedOrganization.load(deps) as { name: string; city: string; iban: string }[];
    expect(row).toMatchObject({ name: 'Musterverein e.V.', city: 'Jülich', iban: 'DE02120300000000202051' });
  });

  it('leaves out what is nobody business on a website', async () => {
    const deps = await setup();
    const [row] = publishedOrganization.load(deps) as Record<string, unknown>[];
    for (const secret of ['taxNumber', 'taxOffice', 'exemptionNoticeType', 'exemptionNoticeDate', 'statutoryPurpose']) {
      expect(row, `${secret} gehört nicht in die veröffentlichte Sicht`).not.toHaveProperty(secret);
    }
  });

  it('yields empty strings rather than undefined, so a template can render them unchecked', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const [row] = publishedOrganization.load(deps) as { phone: string; bic: string }[];
    expect(row?.phone).toBe('');
    expect(row?.bic).toBe('');
  });
});
