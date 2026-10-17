import { describe, expect, it } from 'vitest';
import { readSort } from '@/lib/sort';

describe('readSort', () => {
  it('liest Feld und Richtung aus den Parametern, nur wenn das Feld erlaubt ist', () => {
    const allowed = ['subject', 'documentDate'] as const;
    expect(readSort({ sort: 'subject', dir: 'asc' }, allowed)).toEqual({ field: 'subject', direction: 'asc' });
    expect(readSort({ sort: 'subject' }, allowed)).toEqual({ field: 'subject', direction: 'desc' });
    expect(readSort({ sort: 'draftBody', dir: 'asc' }, allowed)).toBeUndefined();
    expect(readSort({}, allowed)).toBeUndefined();
  });
});

describe('readSort mit Vorgabe (04 B8)', () => {
  it('nimmt die Vorgabe der Seite, wenn die Adresse keine Sortierung nennt', () => {
    const allowed = ['name', 'city'] as const;
    expect(readSort({}, allowed, { field: 'name', direction: 'asc' })).toEqual({ field: 'name', direction: 'asc' });
    expect(readSort({ sort: 'city', dir: 'desc' }, allowed, { field: 'name', direction: 'asc' })).toEqual({ field: 'city', direction: 'desc' });
  });
});
