import { isProvisioned, newId, schema } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { canReadDocumentType, documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installMembers } from '../src/install';
import { memberMemberships, memberNumberCounter, memberTypePeriods, memberTypes } from '../src/schema';
import { deleteMemberType, listMemberTypes, reorderMemberTypes, saveMemberType, setMemberTypeActive, setNextMemberNumber } from '../src/types';
import { auditOf, setupMembers } from './helpers';

const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

describe('basic equipment on install', () => {
  it('creates three member types once, with voting right and fee exemption from the start table', async () => {
    const { deps, ctx } = setupMembers();
    deps.db.transaction((tx) => installMembers(tx, deps, systemContext())); // zweiter Lauf legt nichts doppelt an
    const types = await listMemberTypes(deps, ctx, {});
    expect(types.ok && types.value.map((t) => [t.key, t.name.de, t.hasVotingRight, t.feeExempt])).toEqual([
      ['regular', 'Ordentliches Mitglied', true, false],
      ['supporting', 'Fördermitglied', false, false],
      ['honorary', 'Ehrenmitglied', true, true],
    ]);
  });

  it('a type the association deleted does not come back', async () => {
    const { deps, ctx } = setupMembers();
    const supporting = deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'supporting')).get()!;
    expect((await deleteMemberType(deps, ctx, { id: supporting.id })).ok).toBe(true);
    deps.db.transaction((tx) => installMembers(tx, deps, systemContext()));
    expect(deps.db.select().from(memberTypes).all().map((t) => t.key)).toEqual(['regular', 'honorary']);
  });

  it('brings the document type of the application into the protected area members', () => {
    const { deps } = setupMembers();
    const type = deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'member-application')).get();
    expect(type).toMatchObject({ prefix: 'MAN', ownerModule: 'members', protectionArea: 'members', defaultDirection: 'incoming', retentionClass: 'consent' });
    expect(canReadDocumentType(deps, ctxWith(['dms.view']), 'member-application')).toBe(false);
    expect(canReadDocumentType(deps, ctxWith(['members.read']), 'member-application')).toBe(true);
  });

  it('proposes the role for member administration', () => {
    const { deps } = setupMembers();
    const role = deps.db.select().from(schema.roles).where(eq(schema.roles.originKey, 'members:admin')).get();
    expect(role?.name).toBe('Mitgliederverwaltung');
    // M29: Die Briefe ihrer Läufe mailen (dms.send) und eigene Briefe der Akte festschreiben (dms.file) gehört dazu.
    const permissions = deps.db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role!.id)).all().map((p) => p.permissionKey);
    expect(permissions).toEqual(expect.arrayContaining(['dms.send', 'dms.file']));
    expect(isProvisioned(deps.db, { module: 'members', kind: 'memberTypes', key: 'start' })).toBe(true);
  });
});

describe('member types', () => {
  it('creates a type with a fixed key, updates it and audits both', async () => {
    const { deps, ctx } = setupMembers();
    const created = await saveMemberType(deps, ctx, { key: 'youth', name: { de: 'Jugendmitglied' }, hasVotingRight: false, feeExempt: false });
    expect(created.ok && created.value).toMatchObject({ key: 'youth', active: true, sortOrder: 4 });
    const id = created.ok ? created.value.id : '';
    const updated = await saveMemberType(deps, ctx, { id, key: 'other', name: { de: 'Jugend' }, hasVotingRight: true, feeExempt: false });
    expect(updated.ok && updated.value).toMatchObject({ key: 'youth', hasVotingRight: true, name: { de: 'Jugend' } });
    expect(auditOf(deps, 'members.type.create').at(-1)?.params).toEqual({ key: 'youth' });
    expect(auditOf(deps, 'members.type.update').at(-1)?.params).toEqual({ key: 'youth' });
  });

  it('refuses a key that is taken, a malformed key, a missing key on create and a missing leading name', async () => {
    const { deps, ctx } = setupMembers();
    expect(fail(await saveMemberType(deps, ctx, { key: 'regular', name: { de: 'Doppelt' }, hasVotingRight: true, feeExempt: false }))).toMatchObject({ type: 'conflict', code: 'memberTypeKeyTaken' });
    expect(fail(await saveMemberType(deps, ctx, { key: 'Groß', name: { de: 'X' }, hasVotingRight: true, feeExempt: false }))).toMatchObject({ type: 'validation' });
    expect(fail(await saveMemberType(deps, ctx, { name: { de: 'X' }, hasVotingRight: true, feeExempt: false }))).toMatchObject({ type: 'validation' });
    expect(fail(await saveMemberType(deps, ctx, { key: 'blank', name: { de: '' }, hasVotingRight: true, feeExempt: false }))).toMatchObject({ type: 'validation' });
  });

  it('deactivates and reactivates, and the list hides inactive types unless asked', async () => {
    const { deps, ctx } = setupMembers();
    const honorary = deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'honorary')).get()!;
    expect((await setMemberTypeActive(deps, ctx, { id: honorary.id, active: false })).ok).toBe(true);
    const visible = await listMemberTypes(deps, ctx, {});
    expect(visible.ok && visible.value.map((t) => t.key)).toEqual(['regular', 'supporting']);
    const all = await listMemberTypes(deps, ctx, { includeInactive: true });
    expect(all.ok && all.value.length).toBe(3);
    expect(auditOf(deps, 'members.type.deactivate').at(-1)?.params).toEqual({ key: 'honorary' });
    await setMemberTypeActive(deps, ctx, { id: honorary.id, active: true });
    expect(auditOf(deps, 'members.type.activate')).toHaveLength(1);
  });

  it('reorders all types and audits once', async () => {
    const { deps, ctx } = setupMembers();
    const ids = deps.db.select().from(memberTypes).all().map((t) => t.id).reverse();
    expect((await reorderMemberTypes(deps, ctx, { ids })).ok).toBe(true);
    const list = await listMemberTypes(deps, ctx, {});
    expect(list.ok && list.value.map((t) => t.key)).toEqual(['honorary', 'supporting', 'regular']);
    expect(auditOf(deps, 'members.type.reorder')).toHaveLength(1);
    expect(fail(await reorderMemberTypes(deps, ctx, { ids: ids.slice(1) }))).toMatchObject({ type: 'validation' });
  });

  it('deletes a type without any period, refuses one in use with the count', async () => {
    const { deps, ctx } = setupMembers();
    const regular = deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'regular')).get()!;
    const membershipId = newId();
    deps.db.insert(memberMemberships).values({ id: membershipId, contactId: 'C1', appliedOn: '2026-01-10', createdAt: 'x', updatedAt: 'x' }).run();
    deps.db.insert(memberTypePeriods).values({ id: newId(), membershipId, typeId: regular.id, validFrom: '2026-01-10' }).run();
    const refused = fail(await deleteMemberType(deps, ctx, { id: regular.id }));
    expect(refused).toMatchObject({ type: 'conflict', code: 'memberTypeInUse', params: { count: 1 } });

    const honorary = deps.db.select().from(memberTypes).where(eq(memberTypes.key, 'honorary')).get()!;
    expect((await deleteMemberType(deps, ctx, { id: honorary.id })).ok).toBe(true);
    expect(deps.db.select().from(memberTypes).where(eq(memberTypes.id, honorary.id)).get()).toBeUndefined();
    expect(auditOf(deps, 'members.type.delete').at(-1)?.params).toEqual({ key: 'honorary' });
  });

  it('needs members.fees to change and members.read to list', async () => {
    const { deps } = setupMembers(['members.read', 'members.manage']);
    const ctx = ctxWith(['members.read', 'members.manage']);
    const id = deps.db.select().from(memberTypes).all()[0]!.id;
    expect(fail(await saveMemberType(deps, ctx, { key: 'x1', name: { de: 'X' }, hasVotingRight: true, feeExempt: false }))).toMatchObject({ type: 'forbidden', permission: 'members.fees' });
    expect(fail(await setMemberTypeActive(deps, ctx, { id, active: false }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await reorderMemberTypes(deps, ctx, { ids: [id] }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await deleteMemberType(deps, ctx, { id }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await setNextMemberNumber(deps, ctx, { next: 5 }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await listMemberTypes(deps, ctxWith(['contacts.view']), {}))).toMatchObject({ type: 'forbidden', permission: 'members.read' });
  });
});

describe('next member number', () => {
  it('moves the counter so the next admission gets the given number, and audits it', async () => {
    const { deps, ctx } = setupMembers();
    expect((await setNextMemberNumber(deps, ctx, { next: 8 })).ok).toBe(true);
    expect(deps.db.select().from(memberNumberCounter).get()).toEqual({ id: 'member', last: 7 });
    expect(auditOf(deps, 'members.numbers.setNext').at(-1)?.params).toEqual({ next: 8 });
  });

  it('refuses a number at or below the last one given, and a number that is no positive integer', async () => {
    const { deps, ctx } = setupMembers();
    await setNextMemberNumber(deps, ctx, { next: 8 });
    expect(fail(await setNextMemberNumber(deps, ctx, { next: 7 }))).toMatchObject({ type: 'conflict', code: 'memberNumberTooLow', params: { last: 7 } });
    expect(fail(await setNextMemberNumber(deps, ctx, { next: 0 }))).toMatchObject({ type: 'validation' });
    expect(fail(await setNextMemberNumber(deps, ctx, { next: 2.5 }))).toMatchObject({ type: 'validation' });
  });
});
