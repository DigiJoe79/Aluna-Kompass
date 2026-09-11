import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createDocumentRule,
  createDocumentType,
  DEFAULT_DOCUMENT_TYPES,
  deleteDocumentRule,
  documentTypeFor,
  listDocumentRules,
  listDocumentTypes,
  updateDocumentRule,
  updateDocumentType,
} from '../src/catalog';
import { documentTypes } from '../src/schema';
import { ALL_DMS, auditActions, setupWithTypes } from './helpers';

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
    for (const type of DEFAULT_DOCUMENT_TYPES) expect(type.prefix).toMatch(/^[A-Z]{3}$/);
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

    const rules = await listDocumentRules(deps, ctx);
    expect(rules.ok).toBe(true);
    if (!rules.ok) return;
    expect(rules.value).toHaveLength(1);

    const deleted = await deleteDocumentRule(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.rule.delete');
  });
});

