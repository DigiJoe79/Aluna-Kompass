import { unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { dmsFollowUpTargets } from '../src/follow-ups';
import { linkDocumentInternal } from '../src/linked';
import { dmsRecordLabels } from '../src/record-labels';
import { dmsRecordReferences } from '../src/record-references';
import { dmsRetentionDue, dmsRetentionHolds } from '../src/retention';
import { documentTypes, documents } from '../src/schema';
import { setupWithArea } from './helpers';

const SUBJECT = 'Streng geheimer Betreff';

describe('hooks and protected document types', () => {
  it('never carry the subject — they do not know who is asking', async () => {
    const { deps, all, secretId } = await setupWithArea();
    deps.db.transaction((tx) => linkDocumentInternal(tx, deps, { documentId: secretId, entityType: 'animal', entityId: 'A1' }));
    deps.db.update(documentTypes).set({ defaultDirection: 'outgoing' }).where(eq(documentTypes.key, 'secret')).run();
    const draft = unwrap(await createDraft(deps, all, { typeKey: 'secret', subject: SUBJECT, body: '', links: [{ entityType: 'animal', entityId: 'A1', role: 'about' }] }));
    deps.db.update(documents).set({ documentDate: '2001-01-01' }).where(eq(documents.id, secretId)).run();

    const everything = JSON.stringify([
      dmsRecordReferences(deps, 'animal', 'A1'),
      dmsRetentionHolds(deps, 'animal', 'A1'),
      dmsRetentionDue(deps),
      dmsFollowUpTargets(deps, 'document', secretId),
      dmsFollowUpTargets(deps, 'document', draft.id),
    ]);
    expect(everything).not.toContain(SUBJECT);
    expect(everything).toContain('GEH-');
    expect(dmsRecordReferences(deps, 'animal', 'A1').map((r) => r.label)).toContain('Entwurf (geschützt)');
    expect(dmsFollowUpTargets(deps, 'document', draft.id)!.label).toBe('Entwurf (geschützt)');
  });

  it('recordLabels knows the caller: the area permission sees the subject, dms.view does not', async () => {
    const { deps, viewer, auditor, secretId, openId } = await setupWithArea();
    expect(dmsRecordLabels(deps, viewer, 'document', secretId)).toMatchObject({ state: 'forbidden', href: null });
    expect(dmsRecordLabels(deps, viewer, 'document', secretId)!.label).toMatch(/^GEH-.*, geschützt$/);
    expect(dmsRecordLabels(deps, auditor, 'document', secretId)).toMatchObject({ state: 'ok', label: expect.stringContaining(SUBJECT) });
    expect(dmsRecordLabels(deps, auditor, 'document', openId)).toMatchObject({ state: 'forbidden' });
  });
});
