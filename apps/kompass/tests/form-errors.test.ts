import { describe, expect, it } from 'vitest';
import { invalidFields, invalidTabs } from '@/lib/form-errors';

/**
 * Ein Fehler im hinteren Reiter ist ein Fehler, den niemand sieht: Das
 * Formular springt nicht dorthin, und der vordere Reiter zeigt nichts an. Der
 * Nutzer drückt Speichern und hält es für kaputt.
 */
describe('invalidTabs', () => {
  const tabs = [
    { key: 'profile', fields: ['name', 'slug', 'sizeCm'] },
    { key: 'texts', fields: ['summary', 'body'] },
  ];

  it('nennt den Reiter, in dem das Feld steht', () => {
    expect(invalidTabs(tabs, { body: 'Pflichtfeld' })).toEqual(new Set(['texts']));
  });

  it('erkennt ein Sprachfeld an seinem Rumpf', () => {
    // Sprachfelder melden als `summary.de`, deklariert ist `summary`.
    expect(invalidTabs(tabs, { 'summary.de': 'Pflichtfeld' })).toEqual(new Set(['texts']));
  });

  it('nennt beide, wenn es beide trifft', () => {
    expect(invalidTabs(tabs, { name: 'x', body: 'y' })).toEqual(new Set(['profile', 'texts']));
  });

  it('bleibt leer, wenn nichts fehlschlug', () => {
    expect(invalidTabs(tabs, {})).toEqual(new Set());
  });
});

describe('invalidFields', () => {
  it('zählt ein Sprachfeld einmal, nicht je Sprache', () => {
    expect(invalidFields({ 'summary.de': 'x', 'summary.en': 'x', name: 'z' }, { summary: 'Kurz', name: 'Name' })).toEqual([
      { key: 'summary', label: 'Kurz', messages: ['x'] },
      { key: 'name', label: 'Name', messages: ['z'] },
    ]);
  });

  it('nimmt den ganzen Schlüssel, wenn das Formular ihn selbst benennt', () => {
    expect(invalidFields({ 'organization.name': 'x', 'organization.city': 'y' }, { 'organization.name': 'A', 'organization.city': 'B' })).toHaveLength(2);
  });

  it('gibt ohne Namen `null` statt des Schlüssels', () => {
    expect(invalidFields({ 'externalLinks.0.url': 'x' }, {})).toEqual([{ key: 'externalLinks', label: null, messages: ['x'] }]);
  });

  it('bleibt leer ohne Fehler', () => {
    expect(invalidFields({}, {})).toEqual([]);
  });
});
