import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/**
 * „Finanzen einrichten“ ist der Name des Rechts, nicht der Seite: Die Seite heißt in der Navigation
 * „Finanzen“ (Einstellungen → Finanzen). Hilfetexte nennen als Ort deshalb „Einstellungen → Finanzen“.
 */
function texts(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => texts(v, `${path}.${k}`));
  return [];
}

describe('Hilfetexte nennen die Finanz-Einrichtung unter ihrem Seitennamen', () => {
  it('„Finanzen einrichten“ steht nie als Ort', () => {
    const asPlace = /(?:unter|Unter) „?Finanzen einrichten|Finanzen einrichten →|Finanzen einrichten“ →/;
    expect(texts(messages, '').filter(({ text }) => asPlace.test(text)).map(({ path }) => path)).toEqual([]);
  });
});
