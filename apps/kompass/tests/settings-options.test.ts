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
  it('lists IANA zones readable and keeps an unknown current value', () => {
    const options = timeZoneOptions('UTC');
    expect(options).toContainEqual({ value: 'Europe/Berlin', label: 'Europe/Berlin' });
    expect(options).toContainEqual({ value: 'America/New_York', label: 'America/New York' });
    expect(options[0]).toEqual({ value: 'UTC', label: 'UTC' });
  });
});
