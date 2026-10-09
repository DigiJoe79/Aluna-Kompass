import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { DERIVED, sentencePlaceholder } from '@/lib/audit-sentences';
import { installedModules } from '@/modules';

const sentences = (messages.audit as { sentences: Record<string, string> }).sentences;
const catalog = createRegistry([coreModule, ...installedModules]).auditActions;
const actionByKey = new Map([...catalog].map(([action, def]) => [action.replaceAll('.', '_'), def]));

/** Alle Platzhalter einer ICU-Nachricht, auch in den Zweigen von `select` und `plural`. */
function placeholders(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
    if (el.type === TYPE.select || el.type === TYPE.plural) {
      out.add(el.value);
      for (const option of Object.values(el.options)) placeholders(option.value, out);
    }
    if (el.type === TYPE.tag) placeholders(el.children, out);
  }
  return out;
}

/**
 * Spec Protokoll § 6, Wächter 2: Jeder Satz gehört zu einer Aktion im Katalog und nutzt nur deren Werte — dieselbe
 * Abbildung der Personen-Schlüssel (`sentencePlaceholder`), die `auditSentences` nutzt, damit Satz und Wächter nicht
 * auseinanderlaufen.
 */
describe('Sätze des Protokolls', () => {
  it('gehören zu einer Aktion im Katalog und nutzen nur deren Werte', () => {
    const problems: string[] = [];
    for (const [key, message] of Object.entries(sentences)) {
      const def = actionByKey.get(key);
      if (!def) {
        problems.push(`audit.sentences.${key} hat keine Aktion im Katalog`);
        continue;
      }
      const derived = Object.entries(DERIVED).find(([action]) => action.replaceAll('.', '_') === key)?.[1] ?? {};
      const allowed = new Set([...def.params.map(sentencePlaceholder), ...Object.keys(derived)]);
      for (const name of placeholders(parse(message))) if (!allowed.has(name)) problems.push(`audit.sentences.${key}: {${name}} steht nicht im Katalog`);
    }
    expect(problems).toEqual([]);
  });

  it('findet einen fremden Platzhalter, auch in einem Zweig', () => {
    expect([...placeholders(parse('{a, select, x {{b}} other {{c, plural, one {# d} other {{e}}}}}'))].sort()).toEqual(['a', 'b', 'c', 'e']);
  });
});
