import { coreModule, defineModule, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { auditEntityLabels, auditEntityWord, auditObject } from '@/lib/audit-entities';
import { labelsFrom } from '@/lib/audit-sentences';

type T = Parameters<typeof auditObject>[0];
const probe = defineModule({ key: 'probe', version: '0', permissions: [], recordLabels: (_deps, _ctx, type) => (type === 'probeThing' ? { label: 'Ding T-1', name: 'T-1', href: null, state: 'ok' } : null) });
const all = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin', onError: () => {} });
const t = createTranslator({ locale: 'de', messages, namespace: 'audit', timeZone: 'Europe/Berlin', onError: () => {} }) as unknown as T;

/**
 * Befund 48: Das Protokoll trägt bei Kontakten nur die ID. Die Ansicht löst den
 * Namen live auf, solange es den Kontakt gibt; ein gelöschter zeigt, dass er
 * gelöscht ist — der Name ist mit ihm verschwunden.
 */
describe('auditEntityLabels', () => {
  it('löst den Namen eines bestehenden Kontakts live auf und markiert einen gelöschten', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    const userId = insertUser(deps, {});
    const ctx = ctxWith(['contacts.view', 'contacts.manage', 'audit.view'], userId);
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts']));
    const contact = await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Muster' });
    if (!contact.ok) throw new Error('setup');

    const labels = auditEntityLabels(deps, ctx, [
      { id: 'E1', entityType: 'contact', entityId: contact.value.id },
      { id: 'E2', entityType: 'contact', entityId: 'GELOESCHT' },
      { id: 'E3', entityType: 'setting', entityId: 'organization.name' },
    ]);
    expect(labels).toEqual({
      E1: { state: 'ok', label: 'Erika Muster' },
      E2: { state: 'missing' },
    });
  });

  /** Joe 2026-10-09: Name statt ID auch für Einstellung, Sprache und Backup — Beschriftungen der Oberfläche. */
  it('nennt Nutzer, Einstellung, Sprache und Backup mit Namen; eine Einstellung ohne Beschriftung bleibt ohne', () => {
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith([]), 'modules.enabled', ['probe']));
    const userId = insertUser(deps, { name: 'Anna Berger' });
    const ctx = ctxWith(['audit.view'], userId);
    const labels = auditEntityLabels(
      deps,
      ctx,
      [
        { id: 'U1', entityType: 'user', entityId: userId },
        { id: 'U2', entityType: 'user', entityId: 'WEG' },
        { id: 'S1', entityType: 'setting', entityId: 'organization.name' },
        { id: 'S2', entityType: 'setting', entityId: 'modules.enabled' },
        { id: 'L1', entityType: 'locale', entityId: 'en' },
        { id: 'B1', entityType: 'backup', entityId: 'kompass-2026-10-09.tar.gz' },
        { id: 'X1', entityType: 'sitePublish', entityId: '01M3MQP' },
        { id: 'P1', entityType: 'probeThing', entityId: 'T1' },
      ],
      { label: labelsFrom(all as never), locale: 'de' },
    );
    expect(labels).toEqual({
      U1: { state: 'ok', label: 'Anna Berger' },
      U2: { state: 'missing' },
      S1: { state: 'ok', label: 'Vereinsname' },
      L1: { state: 'ok', label: 'Englisch' },
      B1: { state: 'ok', label: 'kompass-2026-10-09.tar.gz' },
      // `name` geht vor `label`: Die Art setzt das Protokoll selbst davor.
      P1: { state: 'ok', label: 'T-1' },
    });
  });
});

/** Die Spalte „Objekt“: „Typ · Name“, ohne Namen nur der Typ, nie die ID (Joe 2026-10-09). */
describe('auditObject', () => {
  it('nennt den Typ in Worten und den Namen dahinter; „gelöscht“ steht eigens, damit die Anzeige es dämpft', () => {
    expect(auditObject(t, { entityType: 'user' }, { state: 'ok', label: 'Anna Berger' })).toEqual({ word: 'Nutzer', name: 'Anna Berger', deleted: null });
    expect(auditObject(t, { entityType: 'contact' }, { state: 'missing' })).toEqual({ word: 'Kontakt', name: null, deleted: 'gelöscht' });
    expect(auditObject(t, { entityType: 'sitePublish' }, undefined)).toEqual({ word: 'Veröffentlichung der Webseite', name: null, deleted: null });
  });

  it('fällt ohne Wort auf den Schlüssel zurück', () => {
    expect(auditEntityWord(t, 'kenntNiemand')).toBe('kenntNiemand');
    expect(auditEntityWord(t, 'financeOpenItem')).toBe('Offene Zahlung');
    expect(auditEntityWord(t, 'financePeriodEvent')).toBe('Geschäftsjahr');
    expect(auditEntityWord(t, 'backup')).toBe('Backup');
  });
});
