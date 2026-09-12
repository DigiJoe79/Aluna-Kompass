import { readSetting } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPATCH_CHANNELS } from '../src/install';
import { setupWithTypes } from './helpers';

const columns = (deps: ReturnType<typeof setupWithTypes>['deps'], table: string) =>
  (deps.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();

describe('Schema Akte fertig', () => {
  it('kennt die vier neuen Tabellen', () => {
    const { deps } = setupWithTypes();
    expect(columns(deps, 'document_relations')).toEqual(['created_at', 'created_by_user_id', 'document_id', 'id', 'kind', 'related_document_id']);
    expect(columns(deps, 'document_notes')).toEqual(['body', 'created_at', 'created_by_user_id', 'document_id', 'id']);
    expect(columns(deps, 'document_snippets')).toEqual(['body', 'id', 'is_active', 'name', 'sort_order', 'subject']);
    expect(columns(deps, 'document_counters')).toEqual(['last', 'prefix', 'year']);
  });

  it('das Dokument trägt den Versandvermerk', () => {
    const { deps } = setupWithTypes();
    expect(columns(deps, 'documents')).toEqual(expect.arrayContaining(['sent_at', 'sent_via', 'sent_note']));
  });

  it('die Versandwege sind eine Einstellung mit Vorgabeliste', () => {
    const { deps } = setupWithTypes();
    const channels = readSetting<{ key: string; label: string }[]>(deps, 'dms.dispatchChannels');
    expect(channels).toEqual(DEFAULT_DISPATCH_CHANNELS);
    expect(channels.map((c) => c.key)).toEqual(['post', 'registeredMail', 'email', 'inPerson', 'portal', 'other']);
  });
});
