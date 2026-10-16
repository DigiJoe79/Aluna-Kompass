import { describe, expect, it } from 'vitest';
import messages from '../../messages/de.json';

/**
 * Begriffe (MUSTER § Begriffe, Designer 2026-10-16 Stufe 2 Nr. 10 mit Joes Nachtrag): Was ein Mensch liest, sagt
 * „Agent“ statt „MCP“, „Publizieren“ statt „Publish“/„Veröffentlichen“, „URL-Teil“ statt „Slug“, „Vorgabe“ statt
 * „Default“, „Test“ statt „Staging“, „← Elternseite“ statt „Zurück zu …“, ein Verb statt „OK“. Geprüft wird jeder
 * Text in `messages/de.json`; Schlüssel, Werkzeugnamen und Protokoll-Schlüssel bleiben, wie sie sind. Ausnahmen
 * stehen je Schlüssel mit Grund in der Erlaubnisliste und werden gezählt: Fällt eine weg, wird der Test rot.
 */
interface Rule {
  pattern: RegExp;
  allowed?: Record<string, string>;
}

const RULES: Record<string, Rule> = {
  mcp: {
    pattern: /MCP/,
    allowed: {
      'profile.tokens.intro': 'API-Tokens: „MCP“ nur bei den Tokens und der Einrichtung der Schnittstelle.',
    },
  },
  publish: { pattern: /Publish/ },
  veroeffentlichen: { pattern: /[Vv]eröffentlich/ },
  slug: { pattern: /Slug/ },
  zurueckZu: { pattern: /Zurück zu[mr]? / },
  ok: { pattern: /^(OK|Ok)$/ },
  default: { pattern: /Default/ },
  staging: { pattern: /Staging/ },
  nurEinMensch: { pattern: /nur ein Mensch/ },
  buchungStorniert: { pattern: /Buchung[^.]*storniert|storniert[^.]*Buchung/ },
  dokumentZurueckgenommen: {
    pattern: /Dokument[^.]*zurückgenommen/,
    allowed: {
      'audit.actions.dms_dispatch_clear': 'Zurückgenommen wird der Versandvermerk, nicht das Dokument.',
      'audit.sentences.dms_dispatch_clear': 'Zurückgenommen wird der Versandvermerk, nicht das Dokument.',
    },
  },
};

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

const TEXTS = leaves(messages);

describe('Begriffe in der Sprachdatei', () => {
  it.each(Object.entries(RULES))('%s: kein Treffer außerhalb der Erlaubnisliste', (_name, rule) => {
    const hits = TEXTS.filter(([key, text]) => rule.pattern.test(text) && !(key in (rule.allowed ?? {}))).map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it.each(Object.entries(RULES).filter(([, rule]) => rule.allowed))('%s: jede Ausnahme ist noch nötig', (_name, rule) => {
    const stale = Object.keys(rule.allowed!).filter((key) => !TEXTS.some(([k, text]) => k === key && rule.pattern.test(text)));
    expect(stale).toEqual([]);
  });
});
