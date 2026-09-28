import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeXmlEntities, guardXml, secureXmlParser } from '../src/import/xml';

const enc = (s: string) => new TextEncoder().encode(s);
const MAX = { maxBytes: 5_000_000 };

/**
 * Die gemeinsamen Sicherheitseinstellungen für fremdes XML (CAMT, ZUGFeRD):
 * Größenlimit, DOCTYPE und ENTITY abgelehnt, Validator vor dem Parser, der
 * Parser selbst ohne Entitäten.
 */
describe('guardXml', () => {
  it('passes well-formed xml through as text', () => {
    expect(guardXml(enc('<a><b>1</b></a>'), MAX)).toEqual({ ok: true, text: '<a><b>1</b></a>' });
  });

  it('refuses a file above the size limit before decoding it', () => {
    const bytes = enc('<a/>');
    expect(guardXml(bytes, { maxBytes: bytes.byteLength - 1 })).toEqual({ ok: false, code: 'tooLarge' });
    expect(guardXml(bytes, { maxBytes: bytes.byteLength }).ok).toBe(true);
  });

  it('refuses a DOCTYPE and an ENTITY declaration, in any case', () => {
    expect(guardXml(enc('<!DOCTYPE a><a/>'), MAX)).toEqual({ ok: false, code: 'doctypeRefused' });
    expect(guardXml(enc('<?xml version="1.0"?>\n<!doctype a [<!entity x "y">]><a>&x;</a>'), MAX)).toEqual({ ok: false, code: 'doctypeRefused' });
    const entity = readFileSync(path.resolve(import.meta.dirname, 'fixtures/camt/entitaet.xml'));
    expect(guardXml(new Uint8Array(entity), MAX)).toEqual({ ok: false, code: 'doctypeRefused' });
  });

  it('refuses text that is not xml or not well-formed', () => {
    expect(guardXml(enc('keine XML-Datei'), MAX)).toEqual({ ok: false, code: 'notXml' });
    expect(guardXml(enc('<a><b></a>'), MAX)).toEqual({ ok: false, code: 'notXml' });
  });

  it('decodes utf-8 and utf-16 with a byte order mark', () => {
    expect(guardXml(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<ä/>')]), MAX)).toEqual({ ok: true, text: '<ä/>' });
    const utf16le = new Uint8Array([0xff, 0xfe, ...Buffer.from('<a>ü</a>', 'utf16le')]);
    expect(guardXml(utf16le, MAX)).toEqual({ ok: true, text: '<a>ü</a>' });
  });
});

describe('secureXmlParser', () => {
  it('strips namespace prefixes, keeps attributes and text as strings, never expands entities', () => {
    const parsed = secureXmlParser().parse('<ns:a xmlns:ns="urn:x"><ns:b id="7">0019.50</ns:b><ns:c>&amp;lt;</ns:c></ns:a>') as Record<string, Record<string, unknown>>;

    expect(parsed.a!.b).toEqual({ '#text': '0019.50', '@_id': '7' });
    expect(parsed.a!.c).toBe('&amp;lt;');
  });

  it('turns the named tags into arrays, even when they occur once', () => {
    const parsed = secureXmlParser({ arrays: ['b'] }).parse('<a><b>1</b><c>2</c></a>') as Record<string, Record<string, unknown>>;

    expect(parsed.a!.b).toEqual(['1']);
    expect(parsed.a!.c).toBe('2');
  });
});

describe('decodeXmlEntities', () => {
  it('resolves the five predefined entities and character references, once, and nothing else', () => {
    expect(decodeXmlEntities('M &amp; S &lt;GmbH&gt; &quot;x&quot; &apos;y&apos; &#228;&#xFC;')).toBe('M & S <GmbH> "x" \'y\' äü');
    // Einmal auflösen: `&amp;lt;` ist der Text `&lt;`, nicht `<`.
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
    // Unbekanntes bleibt stehen, wie es ist — eine DTD gibt es nie (guardXml).
    expect(decodeXmlEntities('&secret; &#xZZ; &#1114112;')).toBe('&secret; &#xZZ; &#1114112;');
  });
});
