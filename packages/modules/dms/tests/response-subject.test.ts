import type { Deps } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { responseSubject } from '../src/response-subject';

const depsFor = (locale: string) => ({ locales: () => [locale] }) as unknown as Deps;

describe('responseSubject', () => {
  it('setzt das Datum auf Deutsch als TT.MM.JJJJ', () => {
    expect(responseSubject(depsFor('de'), 'incoming', '2026-03-14', 'Antrag')).toBe('Ihr Schreiben vom 14.03.2026: Antrag');
    expect(responseSubject(depsFor('de'), 'outgoing', '2026-03-04', 'Antrag')).toBe('Unser Schreiben vom 04.03.2026: Antrag');
  });

  it('lässt das Datum auf Deutsch weg, wenn es fehlt', () => {
    expect(responseSubject(depsFor('de'), 'incoming', '', 'Antrag')).toBe('Ihr Schreiben: Antrag');
  });

  it('schreibt das Datum auf Englisch ausgeschrieben, ohne führende Null', () => {
    expect(responseSubject(depsFor('en'), 'incoming', '2026-03-14', 'Request')).toBe('Your letter of 14 March 2026: Request');
    expect(responseSubject(depsFor('en'), 'outgoing', '2026-12-04', 'Request')).toBe('Our letter of 4 December 2026: Request');
  });

  it('lässt das Datum auf Englisch weg, wenn es fehlt', () => {
    expect(responseSubject(depsFor('en'), 'outgoing', 'unbekannt', 'Request')).toBe('Our letter: Request');
  });
});
