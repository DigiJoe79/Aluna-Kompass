// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { withoutProtocol } from '@/lib/without-protocol';

// Runde 3, 038: Webadressen in der Liste ohne „https://“; der volle Wert bleibt im `title`.
describe('withoutProtocol', () => {
  it('lässt http(s):// und einen Schrägstrich am Ende weg', () => {
    expect(withoutProtocol('https://www.tierschutz-beispiel.de/')).toBe('www.tierschutz-beispiel.de');
    expect(withoutProtocol('http://example.org/pfad')).toBe('example.org/pfad');
  });
  it('lässt E-Mail und Telefon unverändert', () => {
    expect(withoutProtocol('name@example.org')).toBe('name@example.org');
    expect(withoutProtocol('+49 30 123')).toBe('+49 30 123');
  });
});
