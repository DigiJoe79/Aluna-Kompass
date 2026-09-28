import { unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createDocumentRule,
  createDocumentType,
  deleteDocumentType,
  EXAMPLE_DOCUMENT_TYPES,
  deleteDocumentRule,
  documentTypeFor,
  listDocumentRules,
  listDocumentTypes,
  updateDocumentRule,
  updateDocumentType,
} from '../src/catalog';
import { createDraft } from '../src/drafts';
import { ensureDocumentType } from '../src/provision';
import { documentTypes } from '../src/schema';
import { ALL_DMS, auditActions, fileFixture, setupWithProbe, setupWithTypes } from './helpers';

const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('document types', () => {
  it('liefert Präfix und Fristklasse zu einem Schlüssel', () => {
    const { deps } = setupWithTypes();
    expect(documentTypeFor(deps.db, 'letter')?.prefix).toBe('BRF');
    expect(documentTypeFor(deps.db, 'gibtsnicht')).toBeNull();
  });

  it('verlangt dms.view', async () => {
    const { deps } = setupWithTypes();
    const denied = await listDocumentTypes(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.view')), {});
    expect(denied.ok).toBe(false);
  });

  it('hat für jede Vorgabeart ein dreistelliges Präfix', () => {
    for (const type of EXAMPLE_DOCUMENT_TYPES) expect(type.prefix).toMatch(/^[A-Z]{3}$/);
  });

  it('legt eine Art mit dreistelligem Präfix an', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDocumentType(deps, ctx, {
      key: 'donation-receipt',
      label: 'Zuwendungsbestätigung',
      prefix: 'ZUW',
      defaultDirection: 'outgoing',
      retentionClass: 'statutory10Y',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.prefix).toBe('ZUW');
    expect(auditActions(deps)).toContain('dms.type.create');
  });

  it('a type created by the association belongs to no module and has no protection area', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = unwrap(await createDocumentType(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }));
    expect([created.ownerModule, created.protectionArea]).toEqual([null, null]);
  });

  it('lehnt ein Präfix ab, das nicht aus drei Großbuchstaben besteht', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await createDocumentType(deps, ctx, {
      key: 'x',
      label: 'X',
      prefix: 'Zu',
      defaultDirection: 'outgoing',
      retentionClass: 'consent',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('lässt das Präfix einer bestehenden Art nicht ändern', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await updateDocumentType(deps, ctx, { key: 'letter', label: 'Anschreiben' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prefix).toBe('BRF');
    expect(result.value.label).toBe('Anschreiben');
    const entry = auditEntry(deps, 'dms.type.update');
    expect(entry).toMatchObject({ entityType: 'documentType', entityId: 'letter' });
    expect(JSON.parse(entry.before!)).toMatchObject({ label: 'Brief' });
    expect(JSON.parse(entry.after!)).toMatchObject({ label: 'Anschreiben', isActive: true });
  });

  it('stellt eine Art still, statt sie zu löschen', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await updateDocumentType(deps, ctx, { key: 'letter', isActive: false });
    expect(result.ok).toBe(true);
    const active = await listDocumentTypes(deps, ctx, {});
    if (!active.ok) return;
    expect(active.value.map((t) => t.key)).not.toContain('letter');
  });
});

describe('deleteDocumentType (Task 4)', () => {
  it('deletes a hand-made document type without documents', async () => {
    const { deps, ctx } = setupWithTypes();
    unwrap(await createDocumentType(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }));
    const deleted = await deleteDocumentType(deps, ctx, { key: 'memo' });
    expect(deleted.ok).toBe(true);
    expect(documentTypeFor(deps.db, 'memo')).toBeNull();
    const entry = auditEntry(deps, 'dms.type.delete');
    expect(entry).toMatchObject({ entityType: 'documentType', entityId: 'memo' });
    expect(JSON.parse(entry.before!)).toMatchObject({ key: 'memo', label: 'Vermerk', prefix: 'VMK' });
  });

  it('refuses a type with documents', async () => {
    const { deps, ctx } = setupWithTypes();
    await fileFixture(deps, ctx); // ein festgeschriebener Brief der Art `letter`
    const denied = await deleteDocumentType(deps, ctx, { key: 'letter' });
    expect(code(denied)).toBe('documentTypeHasDocuments');
    expect(documentTypeFor(deps.db, 'letter')).not.toBeNull();
  });

  it('refuses a module-owned type', async () => {
    const { deps, ctx } = setupWithProbe();
    const denied = await deleteDocumentType(deps, ctx, { key: 'probe-note' });
    expect(code(denied)).toBe('documentTypeOwnedByModule');
    expect(documentTypeFor(deps.db, 'probe-note')).not.toBeNull();
  });

  it('refuses to delete a protected type without the area permission', async () => {
    const { deps, ctx, userId } = setupWithProbe();
    deps.db.insert(documentTypes).values({ key: 'probe-memo', label: 'Geheimvermerk', prefix: 'GHV', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 60, ownerModule: null, protectionArea: 'probe' }).run();
    const manageOnly = ctxWith(['dms.manage'], userId);
    const denied = await deleteDocumentType(deps, manageOnly, { key: 'probe-memo' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatchObject({ type: 'forbidden', permission: 'probe.read' });
    expect(documentTypeFor(deps.db, 'probe-memo')).not.toBeNull();

    // Mit dem Recht des Bereichs (voller `ctx`) gelingt es.
    const deleted = await deleteDocumentType(deps, ctx, { key: 'probe-memo' });
    expect(deleted.ok).toBe(true);
    expect(documentTypeFor(deps.db, 'probe-memo')).toBeNull();
  });

  it('refuses a module-provisioned type, even without documents and not owned', async () => {
    const { deps, ctx } = setupWithProbe();
    deps.db.transaction((tx) =>
      ensureDocumentType(tx, deps, systemContext(), { module: 'probe', key: 'probe-voucher', label: 'Beleg', prefix: 'PBV', defaultDirection: 'incoming', retentionClass: 'statutory8Y', owned: false }),
    );
    expect(documentTypeFor(deps.db, 'probe-voucher')?.ownerModule).toBeNull(); // nicht modul-eigen ...
    const denied = await deleteDocumentType(deps, ctx, { key: 'probe-voucher' });
    expect(code(denied)).toBe('documentTypeProvisioned'); // ... aber trotzdem gesperrt
    expect(documentTypeFor(deps.db, 'probe-voucher')).not.toBeNull();
  });

  it('refuses a default type', async () => {
    const { deps, ctx } = setupWithTypes();
    unwrap(await createDocumentType(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }));
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.defaultTypeOutgoing', 'memo', 'test.default'));
    const denied = await deleteDocumentType(deps, ctx, { key: 'memo' });
    expect(code(denied)).toBe('documentTypeIsDefault');
    expect(documentTypeFor(deps.db, 'memo')).not.toBeNull();
  });

  it('verlangt dms.manage', async () => {
    const { deps, ctx } = setupWithTypes();
    unwrap(await createDocumentType(deps, ctx, { key: 'memo', label: 'Vermerk', prefix: 'VMK', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }));
    const denied = await deleteDocumentType(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.manage')), { key: 'memo' });
    expect(denied.ok).toBe(false);
    expect(documentTypeFor(deps.db, 'memo')).not.toBeNull();
  });
});

describe('document rules', () => {
  it('verlangt dms.manage für Regeln', async () => {
    const { deps } = setupWithTypes();
    const denied = await createDocumentRule(
      deps,
      ctxWith(ALL_DMS.filter((p) => p !== 'dms.manage')),
      { matchField: 'filename', matchContains: 'Finanzamt', thenTypeKey: 'authority' },
    );
    expect(denied.ok).toBe(false);
  });

  it('legt eine Regel an, aktualisiert und löscht sie', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDocumentRule(deps, ctx, {
      matchField: 'filename',
      matchContains: 'Finanzamt',
      thenTypeKey: 'authority',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(auditActions(deps)).toContain('dms.rule.create');

    const updated = await updateDocumentRule(deps, ctx, {
      id: created.value.id,
      matchContains: 'Finanzamt Bescheid',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.matchContains).toBe('Finanzamt Bescheid');
    const entry = auditEntry(deps, 'dms.rule.update');
    expect(entry).toMatchObject({ entityType: 'documentRule', entityId: created.value.id });
    expect(JSON.parse(entry.before!)).toMatchObject({ matchContains: 'Finanzamt' });
    expect(JSON.parse(entry.after!)).toMatchObject({ matchContains: 'Finanzamt Bescheid' });

    const rules = await listDocumentRules(deps, ctx);
    expect(rules.ok).toBe(true);
    if (!rules.ok) return;
    expect(rules.value).toHaveLength(1);

    const deleted = await deleteDocumentRule(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.rule.delete');
  });

  describe('prefix', () => {
    const memo = { key: 'memo', label: 'Vermerk', defaultDirection: 'outgoing' as const, retentionClass: 'statutory6Y' as const };
    const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

    it('is unique across document types', async () => {
      const { deps, ctx } = setupWithTypes();
      unwrap(await createDocumentType(deps, ctx, { ...memo, prefix: 'VMK' }));
      expect(code(await createDocumentType(deps, ctx, { ...memo, key: 'memo2', prefix: 'VMK' }))).toBe('documentTypePrefixTaken');
    });

    it('can be changed while the type has no document, and never afterwards', async () => {
      const { deps, ctx } = setupWithTypes();
      unwrap(await createDocumentType(deps, ctx, { ...memo, prefix: 'VMK' }));
      expect(unwrap(await updateDocumentType(deps, ctx, { key: 'memo', prefix: 'VMN' })).prefix).toBe('VMN');
      unwrap(await createDraft(deps, ctx, { typeKey: 'memo', subject: 'x', body: '' }));
      expect(code(await updateDocumentType(deps, ctx, { key: 'memo', prefix: 'VMX' }))).toBe('documentTypeInUse');
    });

    it('cannot be changed to a prefix another type holds', async () => {
      const { deps, ctx } = setupWithTypes();
      unwrap(await createDocumentType(deps, ctx, { ...memo, prefix: 'VMK' }));
      expect(code(await updateDocumentType(deps, ctx, { key: 'memo', prefix: 'BRF' }))).toBe('documentTypePrefixTaken');
    });
  });
});

