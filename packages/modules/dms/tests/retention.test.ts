import { describe, expect, it } from 'vitest';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { dmsRetentionDue, dmsRetentionHolds } from '../src/retention';
import { pdfBytes, setupWithTypes } from './helpers';

describe('dmsRetentionHolds', () => {
  it('nennt das haltende Dokument beim Namen', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'v.pdf',
      bytes: pdfBytes(),
      typeKey: 'contract',
      subject: 'Vertrag',
      documentDate: '2026-03-14',
      links: [{ entityType: 'contact', entityId: 'c-1', role: 'sender' }],
    });
    if (!doc.ok) throw new Error('setup');
    const holds = dmsRetentionHolds(deps, 'contact', 'c-1');
    expect(holds).toHaveLength(1);
    expect(holds[0]!.label).toContain(doc.value.number as string);
    expect(holds[0]!.until).toBe('2036-12-31'); // 10 Jahre ab Ablauf des Kalenderjahres 2026
  });

  it('hält nichts über einen Entwurf', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'x',
      body: 'y',
      links: [{ entityType: 'contact', entityId: 'c-2', role: 'recipient' }],
    });
    expect(dmsRetentionHolds(deps, 'contact', 'c-2')).toHaveLength(0);
  });

  it('hält dauerhaft, wenn die Art permanent ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, {
      filename: 'p.pdf',
      bytes: pdfBytes(),
      typeKey: 'minutes',
      subject: 'Protokoll',
      documentDate: '2020-01-01',
      links: [{ entityType: 'contact', entityId: 'c-3', role: 'about' }],
    });
    expect(dmsRetentionHolds(deps, 'contact', 'c-3')[0]!.until).toBeNull();
  });
});

describe('dmsRetentionDue', () => {
  it('führt ein Dokument auf, dessen Frist abgelaufen ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Alte Rechnung',
      documentDate: '2005-06-01',
    });
    const due = dmsRetentionDue(deps);
    expect(due).toHaveLength(1);
    expect(due[0]!.entity).toBe('document');
  });

  it('führt nichts auf, was noch läuft', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, {
      filename: 'neu.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Neue Rechnung',
      documentDate: '2026-01-01',
    });
    expect(dmsRetentionDue(deps)).toHaveLength(0);
  });
});
