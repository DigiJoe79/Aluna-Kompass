import { coreModule, defineModule, writeSettingInternal, type AuditEntry } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { siteModule } from '@kompass/module-site';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { auditSentenceKey, auditSentences, sentencePlaceholder, type SentenceTranslator } from '@/lib/audit-sentences';

const probe = defineModule({
  key: 'probe',
  version: '0',
  permissions: [],
  auditActions: {
    'probe.rename': { params: ['name', 'targetUserId'] },
    'probe.touch': { params: [] },
    'probe.send': { params: ['number', 'sentAt', 'sentVia'] },
    'probe.link': { params: ['contactId'] },
  },
});

const messages = {
  audit: {
    actions: { probe_rename: 'Umbenannt', probe_send: 'Versandt', probe_link: 'Verknüpft', probe_touch: 'Berührt' },
    sentences: {
      probe_rename: 'Umbenannt in „{name}“ von {targetUser}',
      probe_send: 'Dokument {number} versandt: {sentAt}, {sentVia, select, post {per Post} other {{sentVia}}}',
      probe_link: 'Verknüpft mit {contact}',
      settings_update: 'Einstellung „{key}“ geändert',
      locale_add: 'Sprache „{code}“ hinzugefügt',
      backup_export: 'Backup mit {sizeBytes} erstellt',
      site_values_update: '{variableCount, plural, one {Variable} other {Variablen}} {variables} geändert',
      site_seed_apply: '{items} aus der Vorlage der Webseite übernommen',
    },
  },
};
const t = createTranslator({ locale: 'de', messages, namespace: 'audit', timeZone: 'Europe/Berlin', onError: () => {} }) as unknown as SentenceTranslator;

type Entry = Pick<AuditEntry, 'id' | 'action' | 'params' | 'paramUserNames'>;
const e = (over: Partial<Entry>): Entry => ({ id: 'A', action: 'probe.rename', params: null, paramUserNames: {}, ...over });

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, siteModule, probe] });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage', 'audit.view'], userId);
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['contacts']));
  return { deps, ctx };
}

/** Spec Protokoll § 4: Der Satz entsteht beim Anzeigen; ohne Satz oder mit fehlendem Wert steht der Klartext. */
describe('auditSentences', () => {
  it('builds the sentence with the user name', () => {
    const { deps, ctx } = setup();
    expect(auditSentences(deps, ctx, t, [e({ params: { name: 'Neu', targetUserId: 'U1' }, paramUserNames: { U1: 'Erika Muster' } })], { paper: false })).toEqual({ A: 'Umbenannt in „Neu“ von Erika Muster' });
  });

  it('gives null for an old entry without params', () => {
    const { deps, ctx } = setup();
    expect(auditSentences(deps, ctx, t, [e({ params: null })], { paper: false })).toEqual({ A: null });
  });

  it('gives null when a value the catalog names is missing or empty', () => {
    const { deps, ctx } = setup();
    expect(auditSentences(deps, ctx, t, [e({ params: { name: 'Neu' } })], { paper: false })).toEqual({ A: null });
    expect(auditSentences(deps, ctx, t, [e({ params: { name: null, targetUserId: 'U1' } })], { paper: false })).toEqual({ A: null });
  });

  it('gives null for an action without sentence and for an action outside the catalog', () => {
    const { deps, ctx } = setup();
    expect(auditSentences(deps, ctx, t, [e({ action: 'probe.touch', params: {} })], { paper: false })).toEqual({ A: null });
    expect(auditSentences(deps, ctx, t, [e({ action: 'legacy.thing', params: { name: 'x' } })], { paper: false })).toEqual({ A: null });
  });

  it('gives null rather than a key when the sentence asks for a value the entry lacks (a sentence changed later)', () => {
    const { deps, ctx } = setup();
    const later = createTranslator({ locale: 'de', messages: { audit: { ...messages.audit, sentences: { probe_rename: 'Umbenannt in „{name}“ am {renamedOn}' } } }, namespace: 'audit', timeZone: 'Europe/Berlin', onError: () => {} }) as unknown as SentenceTranslator;
    expect(auditSentences(deps, ctx, later, [e({ params: { name: 'Neu', targetUserId: 'U1' } })], { paper: false })).toEqual({ A: null });
  });

  it('formats dates by the setting on screen and fixed on paper, and selects codes', () => {
    const { deps, ctx } = setup();
    const entry = e({ action: 'probe.send', params: { number: 'VER-2026-007', sentAt: '2026-10-09T08:00:00.000Z', sentVia: 'post' } });
    expect(auditSentences(deps, ctx, t, [entry], { paper: true }).A).toBe('Dokument VER-2026-007 versandt: 09.10.2026, per Post');
    const screen = auditSentences(deps, ctx, t, [entry], { paper: false }).A;
    expect(screen).toContain('per Post');
    expect(screen).toContain('10:00');
    expect(screen).not.toContain('2026-10-09T');
  });

  it('names a live contact; a deleted contact, one without read right and a vanished user give null (Klartext)', async () => {
    const { deps, ctx } = setup();
    const contact = await createContact(deps, ctx, { kind: 'person', firstName: 'Erika', lastName: 'Muster' });
    if (!contact.ok) throw new Error('setup');
    expect(auditSentences(deps, ctx, t, [e({ action: 'probe.link', params: { contactId: contact.value.id } })], { paper: false }).A).toBe('Verknüpft mit Erika Muster');
    expect(auditSentences(deps, ctx, t, [e({ action: 'probe.link', params: { contactId: 'GONE' } })], { paper: false }).A).toBeNull();
    const noRight = ctxWith(['audit.view'], 'U2');
    expect(auditSentences(deps, noRight, t, [e({ action: 'probe.link', params: { contactId: contact.value.id } })], { paper: false }).A).toBeNull();
    expect(auditSentences(deps, ctx, t, [e({ params: { name: 'x', targetUserId: 'U9' }, paramUserNames: { U9: null } })], { paper: false }).A).toBeNull();
  });

  it('maps parameter names to placeholders and actions to keys', () => {
    expect(sentencePlaceholder('targetUserId')).toBe('targetUser');
    expect(sentencePlaceholder('contactId')).toBe('contact');
    expect(sentencePlaceholder('recipientContactId')).toBe('recipientContact');
    expect(sentencePlaceholder('number')).toBe('number');
    expect(auditSentenceKey('finance.entry.reverse')).toBe('sentences.finance_entry_reverse');
  });

  it('shows codes as the surface names them, and gives null for a code without a label (Designer 2026-10-09)', () => {
    const { deps, ctx } = setup();
    const label = (k: string) => (k === 'settings.fields.organization.name' ? 'Vereinsname' : null);
    const run = (entry: Entry) => auditSentences(deps, ctx, t, [entry], { paper: false, label, locale: 'de' }).A;
    expect(run(e({ action: 'settings.update', params: { key: 'organization.name' } }))).toBe('Einstellung „Vereinsname“ geändert');
    expect(run(e({ action: 'settings.update', params: { key: 'secret.internal' } }))).toBeNull();
    expect(run(e({ action: 'locale.add', params: { code: 'en' } }))).toBe('Sprache „Englisch“ hinzugefügt');
    expect(run(e({ action: 'backup.export', params: { sizeBytes: 2 * 1024 * 1024 } }))).toBe('Backup mit 2,0 MB erstellt');
  });

  it('joins lists as the surface does and drops parts that are 0 (Designer 2026-10-09)', () => {
    const { deps, ctx } = setup();
    const parts: Record<string, [string, string]> = { 'audit.parts.siteSeed.variables': ['Variable', 'Variablen'], 'audit.parts.siteSeed.entries': ['Eintrag', 'Einträge'], 'audit.parts.siteSeed.assets': ['Datei', 'Dateien'] };
    const label = (k: string, v?: Record<string, string | number>) => (parts[k] ? `${v!.count} ${parts[k]![v!.count === 1 ? 0 : 1]}` : null);
    const run = (entry: Entry) => auditSentences(deps, ctx, t, [entry], { paper: false, label, locale: 'de' }).A;
    expect(run(e({ action: 'site.values.update', params: { variables: 'claim', variableCount: 1 } }))).toBe('Variable „claim“ geändert');
    expect(run(e({ action: 'site.values.update', params: { variables: 'steps, claim', variableCount: 2 } }))).toBe('Variablen „steps“ und „claim“ geändert');
    expect(run(e({ action: 'site.values.update', params: { variables: 'a, b, c', variableCount: 3 } }))).toBe('Variablen „a“, „b“ und „c“ geändert');
    expect(run(e({ action: 'site.seed.apply', params: { variables: 12, entries: 8, assets: 5 } }))).toBe('12 Variablen, 8 Einträge und 5 Dateien aus der Vorlage der Webseite übernommen');
    expect(run(e({ action: 'site.seed.apply', params: { variables: 1, entries: 0, assets: 2 } }))).toBe('1 Variable und 2 Dateien aus der Vorlage der Webseite übernommen');
    expect(run(e({ action: 'site.seed.apply', params: { variables: 0, entries: 0, assets: 0 } }))).toBeNull();
  });
});
