import { describe, expect, it } from 'vitest';
import { countryOptions, timeZoneOptions } from '@/lib/settings-options';

/** 11-1 B19: Land und Zeitzone als Auswahl mit Klarnamen; gespeichert bleibt der Code. */
describe('countryOptions', () => {
  it('lists countries by name with their code as value, without groupings like EU', () => {
    const options = countryOptions('de');
    expect(options).toContainEqual({ value: 'DE', label: 'Deutschland' });
    expect(options).toContainEqual({ value: 'AT', label: 'Österreich' });
    expect(options.find((o) => o.value === 'EU')).toBeUndefined();
    const labels = options.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
  });
});

describe('timeZoneOptions', () => {
  // Runde 3, 149: nicht der technische Name „Europe/Berlin“, sondern Ort und Zeit über `Intl`; gespeichert bleibt der Name.
  it('names zones by city and generic zone name, sorted, and keeps an unknown current value first', () => {
    const options = timeZoneOptions('UTC', 'de');
    expect(options).toContainEqual({ value: 'Europe/Berlin', label: 'Berlin (Mitteleuropäische Zeit)' });
    expect(options).toContainEqual({ value: 'America/New_York', label: 'New York (Nordamerikanische Ostküstenzeit)' });
    expect(options[0]).toEqual({ value: 'UTC', label: 'UTC' });
    const labels = options.slice(1).map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
  });
});

describe('languageOptions', () => {
  // Runde 3, 180: Vorschläge mit Namen über `Intl.DisplayNames`; gespeichert bleibt der Code, ein freier Code geht weiter.
  it('lists two-letter languages by name with their code, without the ones already there', async () => {
    const { languageOptions } = await import('@/lib/settings-options');
    const options = languageOptions('de', ['de', 'en']);
    expect(options).toContainEqual({ value: 'fr', label: 'Französisch (fr)' });
    expect(options.find((o) => o.value === 'en')).toBeUndefined();
    const labels = options.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
  });
});
