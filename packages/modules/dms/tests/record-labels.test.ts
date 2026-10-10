import { describe, expect, it } from 'vitest';
import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createDraft } from '../src/drafts';
import { dmsRecordLabels } from '../src/record-labels';
import { fileFixture, setupWithArea, setupWithTypes } from './helpers';

describe('dmsRecordLabels', () => {
  it('answers only for documents', () => {
    const { deps } = setupWithTypes();
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'contact', 'C1')).toBeNull();
  });

  /** `name` für die Spalte „Objekt“ im Protokoll: Nummer und Betreff ohne zweiten Trenner (Designer 2026-10-09). */
  it('labels a filed document for a reader, and only its number for anyone else', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'document', doc.id)).toEqual({ label: `${doc.number} · ${doc.subject}`, name: `${doc.number} ${doc.subject}`, href: `/dms/${doc.id}`, state: 'ok', sensitive: false, auditLabel: doc.number });
    expect(dmsRecordLabels(deps, ctxWith([]), 'document', doc.id)).toEqual({ label: { key: 'dms.records.protected', params: { number: doc.number } }, href: null, state: 'forbidden', sensitive: false, auditLabel: doc.number });
  });

  it('says missing for an unknown id', () => {
    const { deps } = setupWithTypes();
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'document', 'NOPE')).toEqual({ label: '', href: null, state: 'missing' });
  });

  /**
   * Der Entwurf eines Briefs heißt im Protokoll nach seinem Betreff (Joe 2026-10-09) — live, mit Rechteprüfung, und
   * nicht bei geschützten Arten: Der Betreff kann Personen nennen und steht deshalb nie im Protokoll selbst.
   */
  it('labels a draft with its subject for a reader, never for a protected type', async () => {
    const { deps, all, viewer } = await setupWithArea();
    const open = unwrap(await createDraft(deps, all, { typeKey: 'letter', subject: 'Einladung zum Sommerfest', body: '' }));
    const secret = unwrap(await createDraft(deps, all, { typeKey: 'secret', subject: 'Streng geheim', body: '' }));
    expect(dmsRecordLabels(deps, viewer, 'documentDraft', open.id)).toEqual({ label: 'Einladung zum Sommerfest', href: `/dms/${open.id}`, state: 'ok' });
    expect(dmsRecordLabels(deps, ctxWith([]), 'documentDraft', open.id)).toEqual({ label: { key: 'dms.records.protectedDraft' }, href: null, state: 'forbidden' });
    expect(dmsRecordLabels(deps, all, 'documentDraft', secret.id)).toEqual({ label: { key: 'dms.records.protectedDraft' }, href: null, state: 'forbidden' });
    expect(dmsRecordLabels(deps, all, 'documentDraft', 'NOPE')).toEqual({ label: '', href: null, state: 'missing' });
  });
});
