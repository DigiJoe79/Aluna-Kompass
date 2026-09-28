import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { findRecordReferences } from '../src/deletion-guards';
import { resolveFollowUpTarget } from '../src/follow-ups/targets';
import { defineModule } from '../src/modules/manifest';
import { resolveRecordLabel } from '../src/modules/record-hooks';
import { collectRetentionDue, holdsFor } from '../src/retention/service';
import { createTestDeps, ctxWith } from '../src/testing';

/**
 * K2 (Rest von Befund 49): Ein Modul nennt die Bezeichnung eines Halters, Verweises oder Datensatzes als Schlüssel
 * der Sprachdatei samt Parametern, nie als deutschen Satz. Der Kern löst sie beim Einsammeln über `deps.labels` auf,
 * das die App mit der Sprachdatei belegt — Oberfläche, MCP und Konfliktmeldungen sehen denselben Text.
 */
const ref = (id: string) => ({ key: 'probe.records.thing', params: { number: `T-${id}` } });
const probe = defineModule({
  key: 'probe',
  version: '0',
  permissions: [],
  retentionHolds: (_deps, entityType, id) => (entityType === 'thing' ? [{ label: ref(id), until: null, entity: 'probeThing', id }] : []),
  retentionDue: () => [{ entity: 'probeThing', id: 'X1', label: ref('X1'), dueSince: '2026-01-01' }],
  recordReferences: (_deps, entityType, id) => (entityType === 'thing' ? [{ label: ref(id), entity: 'probeThing', id }] : []),
  followUpTargets: (_deps, entityType, id) => (entityType === 'thing' ? { label: ref(id), href: null } : null),
  recordLabels: (_deps, _ctx, entityType, id) => (entityType === 'thing' ? { label: ref(id), href: null, state: 'ok', sensitive: true, auditLabel: ref(id) } : null),
});

function setup(labels?: (key: string, params: Record<string, string | number>) => string) {
  const deps = createTestDeps({ manifests: [coreModule, probe] });
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['probe']), updatedAt: 'now' }).run();
  if (labels) deps.labels = labels;
  return deps;
}

describe('Bezeichnungen als Schlüssel der Sprachdatei (K2)', () => {
  it('löst jede Bezeichnung über deps.labels auf', () => {
    const deps = setup((key, params) => `${key === 'probe.records.thing' ? 'Ding' : key} ${params.number}`);
    expect(holdsFor(deps, 'thing', '1').map((h) => h.label)).toEqual(['Ding T-1']);
    expect(collectRetentionDue(deps).map((d) => d.label)).toEqual(['Ding T-X1']);
    expect(findRecordReferences(deps, 'thing', '2').map((r) => r.label)).toEqual(['Ding T-2']);
    expect(resolveFollowUpTarget(deps, 'thing', '3')).toEqual({ label: 'Ding T-3', href: null });
    expect(resolveRecordLabel(deps, ctxWith([]), 'thing', '4')).toMatchObject({ label: 'Ding T-4', auditLabel: 'Ding T-4' });
  });

  it('fällt ohne Übersetzer auf Schlüssel und Parameter zurück, nie auf einen leeren Text', () => {
    const deps = setup();
    expect(holdsFor(deps, 'thing', '1').map((h) => h.label)).toEqual(['probe.records.thing T-1']);
  });
});
