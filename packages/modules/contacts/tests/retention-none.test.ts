import { coreModule, defineModule, holdsFor, retentionMonths, unwrap, writeSettingInternal, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactsRetentionDue } from '../src/retention';
import { contacts } from '../src/schema';
import { addContactRole, createContact, deleteContact, endContactRole } from '../src/service';

const financeLike = defineModule({ key: 'finance', version: '1', permissions: ['finance.view'], dependsOn: ['contacts'], contactRoles: [{ key: 'donor', retention: 'none' }] });

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, financeLike] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['contacts', 'finance'], 'test.enable'));
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage']) };
}
const person = { kind: 'person' as const, firstName: 'Erika', lastName: 'Beispiel' };
const consentYears = (deps: Deps) => Math.floor(retentionMonths(deps, 'consent')! / 12);

describe("a contact role with retention 'none'", () => {
  it('does not hold by itself — a running role no longer keeps its contact forever', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2020-01-01' }));
    const holds = holdsFor(deps, 'contact', contact.id);
    expect(holds.map((h) => h.entity)).toEqual(['contact']); // nur die Grundfrist
    expect(holds[0]!.until).not.toBeNull();
  });

  it('the base period runs from the end of the year the last such role ended, else from the year of creation', async () => {
    const { deps, ctx } = setup(); // TEST_NOW liegt 2026
    const contact = unwrap(await createContact(deps, ctx, person));
    const withRole = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2020-01-01' }));
    const running = holdsFor(deps, 'contact', contact.id)[0]!.until!;
    expect(running.slice(0, 4)).toBe(String(2026 + consentYears(deps))); // Anlagejahr
    unwrap(await endContactRole(deps, ctx, { roleId: withRole.roles[0]!.id, until: '2021-06-30' }));
    expect(holdsFor(deps, 'contact', contact.id)[0]!.until!.slice(0, 4)).toBe(String(2026 + consentYears(deps))); // Anlage 2026 ist später als 2021
    deps.db.update(contacts).set({ createdAt: '2019-03-01T00:00:00.000Z' }).where(eq(contacts.id, contact.id)).run();
    expect(holdsFor(deps, 'contact', contact.id)[0]!.until!.slice(0, 4)).toBe(String(2021 + consentYears(deps)));
  });

  it('such a contact becomes due and can be deleted — it no longer answers “no period proven”', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const withRole = unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'donor', since: '2010-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: withRole.roles[0]!.id, until: '2011-06-30' }));
    deps.db.update(contacts).set({ createdAt: '2010-01-01T00:00:00.000Z' }).where(eq(contacts.id, contact.id)).run();
    expect(contactsRetentionDue(deps).map((d) => d.id)).toEqual([contact.id]);
    expect((await deleteContact(deps, ctx, { id: contact.id })).ok).toBe(true);
  });

  it('a contact without any role still has no period proven', async () => {
    const { deps, ctx } = setup();
    const contact = unwrap(await createContact(deps, ctx, person));
    const res = await deleteContact(deps, ctx, { id: contact.id });
    expect(res.ok ? null : res.error).toMatchObject({ type: 'conflict', code: 'retentionUnknown' });
  });
});
