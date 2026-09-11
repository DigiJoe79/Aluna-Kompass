import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { receiveDocument } from '../src/incoming';
import { createDraft } from '../src/drafts';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

describe('Erkennungszustand am Dokument', () => {
  it('eingegangene Post wartet auf Erkennung', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const ctx = ctxWith(['dms.create', 'dms.view']);

    const result = await receiveDocument(deps, ctx, {
      filename: 'post.pdf',
      typeKey: 'letter',
      subject: 'Eingang',
      documentDate: '2026-09-11',
      bytes: pdf(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.textStatus).toBe('pending');
    expect(result.value.textAttempts).toBe(0);
    expect(result.value.textError).toBeNull();
    expect(result.value.textExtractedAt).toBeNull();
  });

  it('ein Entwurf hat keine Datei und wartet auf nichts', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const ctx = ctxWith(['dms.create', 'dms.view']);

    const result = await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'Entwurf',
      documentDate: '2026-09-11',
      body: 'Text',
      links: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.textStatus).toBeNull();
  });
});
