import { describe, expect, it } from 'vitest';
import { folderHref } from '@/app/(shell)/dms/folder-href';

/** Spec Filterleisten § 3: Ordner sind Ort, keine Filter — ein Ordnerklick behält Suche, Filter und Sortierung. */
describe('folderHref', () => {
  const params = new URLSearchParams('text=Futter&type=letter&unsent=1&folder=alt&inbox=1&sort=number&dir=desc&page=3');

  it('behält Suche, Filter und Sortierung und setzt den neuen Ordner', () => {
    expect(folderHref(params, { folder: 'Behörden/Finanzamt' })).toBe('/dms?text=Futter&type=letter&unsent=1&sort=number&dir=desc&folder=Beh%C3%B6rden%2FFinanzamt');
  });

  it('„Alle Dokumente“ und Eingangskorb nehmen den alten Ort nicht mit', () => {
    expect(folderHref(params, { folder: null })).toBe('/dms?text=Futter&type=letter&unsent=1&sort=number&dir=desc');
    expect(folderHref(params, { folder: null, inbox: true })).toBe('/dms?text=Futter&type=letter&unsent=1&sort=number&dir=desc&inbox=1');
  });

  it('ohne Filter die nackte Adresse', () => {
    expect(folderHref(new URLSearchParams(), { folder: null })).toBe('/dms');
  });
});
