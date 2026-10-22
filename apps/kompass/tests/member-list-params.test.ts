import { describe, expect, it } from 'vitest';
import { typeFilterOptions } from '@/app/(shell)/members/list-params';

describe('typeFilterOptions', () => {
  const types = [
    { id: 'reg', name: 'Ordentliches Mitglied', active: true },
    { id: 'hon', name: 'Ehrenmitglied', active: false },
    { id: 'sup', name: 'Fördermitglied', active: true },
  ];

  it('bietet nur aktive Mitgliedsarten an', () => {
    expect(typeFilterOptions(types, '')).toEqual([
      { value: 'reg', label: 'Ordentliches Mitglied' },
      { value: 'sup', label: 'Fördermitglied' },
    ]);
  });

  it('behält eine abgeschaltete Art, solange sie gewählt ist, damit ein alter Link lesbar bleibt', () => {
    expect(typeFilterOptions(types, 'hon').map((o) => o.value)).toEqual(['reg', 'hon', 'sup']);
  });
});
