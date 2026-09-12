import { describe, expect, it } from 'vitest';
import { readSort } from '@/components/sortable-head';

describe('readSort', () => {
  it('liest Feld und Richtung aus den Parametern, nur wenn das Feld erlaubt ist', () => {
    const allowed = ['subject', 'documentDate'] as const;
    expect(readSort({ sort: 'subject', dir: 'asc' }, allowed)).toEqual({ field: 'subject', direction: 'asc' });
    expect(readSort({ sort: 'subject' }, allowed)).toEqual({ field: 'subject', direction: 'desc' });
    expect(readSort({ sort: 'draftBody', dir: 'asc' }, allowed)).toBeUndefined();
    expect(readSort({}, allowed)).toBeUndefined();
  });
});
