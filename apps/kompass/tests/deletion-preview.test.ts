import type { DeletionPreview } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { toDeletionPreviewView } from '@/lib/deletion-preview';

const preview: DeletionPreview = {
  isPublished: false,
  holds: [{ label: 'Schutzvertrag SV-2026-0007', until: '2036-12-31', entity: 'document', id: 'D1' }, { label: 'Satzung', until: null, entity: 'document', id: 'D3' }],
  references: [{ label: 'Dokument „Anfrage“ (Entwurf)', entity: 'document', id: 'D2', href: '/dms/D2' }, { label: 'Wiedervorlage „Anrufen“', entity: 'followUp', id: 'F1' }],
  media: [
    { id: 'M1', filename: 'rocky-1.png', usedElsewhere: [] },
    { id: 'M2', filename: 'rocky-2.png', usedElsewhere: [] },
    { id: 'M3', filename: 'beide.png', usedElsewhere: ['Tier „Luna“'] },
  ],
  deletable: false,
};

describe('toDeletionPreviewView', () => {
  it('legt Halter und Verweise zu einer Liste zusammen, Halter zuerst und mit Frist', () => {
    expect(toDeletionPreviewView(preview, true).blockers).toEqual([
      { label: 'Schutzvertrag SV-2026-0007', until: '2036-12-31' },
      { label: 'Satzung', until: null },
      { label: 'Dokument „Anfrage“ (Entwurf)', href: '/dms/D2' },
      { label: 'Wiedervorlage „Anrufen“' },
    ]);
  });

  it('zählt die nur hier verwendeten Medien und nennt die geteilten', () => {
    const view = toDeletionPreviewView(preview, true);
    expect(view.exclusiveMedia).toBe(2);
    expect(view.sharedMedia).toEqual([{ filename: 'beide.png', usedElsewhere: ['Tier „Luna“'] }]);
    expect(view.canDeleteMedia).toBe(true);
    expect(toDeletionPreviewView(preview, false).canDeleteMedia).toBe(false);
  });
});
