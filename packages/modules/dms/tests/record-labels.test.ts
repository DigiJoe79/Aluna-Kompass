import { describe, expect, it } from 'vitest';
import { ctxWith } from '@kompass/core/testing';
import { dmsRecordLabels } from '../src/record-labels';
import { fileFixture, setupWithTypes } from './helpers';

describe('dmsRecordLabels', () => {
  it('answers only for documents', () => {
    const { deps } = setupWithTypes();
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'contact', 'C1')).toBeNull();
  });

  it('labels a filed document for a reader, and only its number for anyone else', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'document', doc.id)).toEqual({ label: `${doc.number} · ${doc.subject}`, href: `/dms/${doc.id}`, state: 'ok', sensitive: false, auditLabel: doc.number });
    expect(dmsRecordLabels(deps, ctxWith([]), 'document', doc.id)).toEqual({ label: `${doc.number}, geschützt`, href: null, state: 'forbidden', sensitive: false, auditLabel: doc.number });
  });

  it('says missing for an unknown id', () => {
    const { deps } = setupWithTypes();
    expect(dmsRecordLabels(deps, ctxWith(['dms.view']), 'document', 'NOPE')).toEqual({ label: '', href: null, state: 'missing' });
  });
});
