import { describe, expect, it } from 'vitest';
import { sortProjects } from '@/app/(shell)/projects/sort';

const p = (slug: string, name: string, type: string) => ({ slug, name: { de: name }, type }) as never;
const list = [p('b', 'Bremen', 'shelter'), p('a', 'Achim', 'campaign'), p('c', '', 'shelter')];

describe('sortProjects', () => {
  it('lässt die eigene Reihenfolge ohne Sortierung unverändert', () => {
    expect(sortProjects(list, undefined).map((x: { slug: string }) => x.slug)).toEqual(['b', 'a', 'c']);
  });
  it('sortiert nach dem angezeigten Namen (Slug, wenn der Name fehlt), deutsch', () => {
    expect(sortProjects(list, { field: 'name', direction: 'asc' }).map((x: { slug: string }) => x.slug)).toEqual(['a', 'b', 'c']);
  });
  it('dreht absteigend um', () => {
    expect(sortProjects(list, { field: 'name', direction: 'desc' }).map((x: { slug: string }) => x.slug)).toEqual(['c', 'b', 'a']);
  });
});
