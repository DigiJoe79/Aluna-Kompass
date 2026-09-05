import { describe, expect, it } from 'vitest';
import { alternateFor, pathFor, ROUTES } from '../src/lib/routes';

describe('routes', () => {
  it('maps kinds to de and en paths with trailing slashes', () => {
    expect(pathFor('help', 'de')).toBe('/helfen/');
    expect(pathFor('help', 'en')).toBe('/en/help/');
    expect(pathFor('dog', 'de', 'chiara')).toBe('/zuhause-gesucht/chiara/');
    expect(pathFor('dog', 'en', 'chiara')).toBe('/en/looking-for-a-home/chiara/');
    expect(pathFor('home', 'en')).toBe('/en/');
  });
  it('finds the alternate language path for any path', () => {
    expect(alternateFor('/helfen/')).toEqual({ locale: 'de', other: { locale: 'en', path: '/en/help/' } });
    expect(alternateFor('/en/looking-for-a-home/chiara/')).toEqual({ locale: 'en', other: { locale: 'de', path: '/zuhause-gesucht/chiara/' } });
    expect(Object.keys(ROUTES)).toHaveLength(21);
  });
});
