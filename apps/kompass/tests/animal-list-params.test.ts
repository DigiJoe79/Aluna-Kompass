import { describe, expect, it } from 'vitest';
import { animalListInput, hasListFilter, listQueryString } from '@/app/(shell)/animals/list-params';

describe('animalListInput', () => {
  it('übersetzt die Query-Parameter in die Eingabe des Dienstes', () => {
    expect(animalListInput({})).toEqual({});
    expect(animalListInput({ text: ' lu ', status: 'reserved', location: 'germany', published: '0', review: '1' }))
      .toEqual({ text: 'lu', status: 'reserved', location: 'germany', isPublished: false, reviewPending: true, orderBy: { field: 'reviewRequestedAt', direction: 'asc' } });
    expect(animalListInput({ published: '1' })).toEqual({ isPublished: true });
  });

  it('überliest unbekannte Werte, statt die Seite zu brechen', () => {
    expect(animalListInput({ status: 'x', location: 'mars', published: 'vielleicht', sort: 'body', review: 'ja' })).toEqual({});
    // Länger, als der Dienst annimmt: gekürzt, nicht abgewiesen.
    expect(animalListInput({ text: 'a'.repeat(200) }).text).toHaveLength(80);
  });

  it('„Prüfung offen“ sortiert ohne eigene Wahl nach dem Prüfzeitpunkt; eine Wahl gilt', () => {
    expect(animalListInput({ review: '1' }).orderBy).toEqual({ field: 'reviewRequestedAt', direction: 'asc' });
    expect(animalListInput({ review: '1', sort: 'updatedAt', dir: 'desc' }).orderBy).toEqual({ field: 'updatedAt', direction: 'desc' });
    expect(animalListInput({ sort: 'name', dir: 'asc' }).orderBy).toEqual({ field: 'name', direction: 'asc' });
  });
});

describe('listQueryString', () => {
  it('behält nur die bekannten, nicht leeren Listenparameter, in fester Reihenfolge', () => {
    expect(listQueryString({ review: '1', text: '', tab: 'content', sort: 'name', dir: 'asc' })).toBe('review=1&sort=name&dir=asc');
    expect(listQueryString({ dir: 'desc', sort: 'name', text: 'mik' })).toBe('text=mik&sort=name&dir=desc');
    expect(listQueryString({})).toBe('');
  });
});

describe('hasListFilter', () => {
  it('zählt Sortierung nicht als Filter', () => {
    expect(hasListFilter({ sort: 'name', dir: 'asc' })).toBe(false);
    expect(hasListFilter({ text: '  ' })).toBe(false);
    expect(hasListFilter({ review: '1' })).toBe(true);
    expect(hasListFilter({ status: 'adopted' })).toBe(true);
  });
});
