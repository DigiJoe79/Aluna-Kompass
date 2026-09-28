import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { CONTACTS_MCP_TOOLS } from '../src/mcp-tools';

describe('contacts_create über MCP (M11)', () => {
  const schema = CONTACTS_MCP_TOOLS.find((t) => t.name === 'contacts_create')!.inputSchema as ZodType;

  it('zeigt auf oberster Ebene ein Objekt mit beiden Arten, nicht eine Union', () => {
    const json = (schema as unknown as { toJSONSchema?: () => unknown }).toJSONSchema?.() ?? {};
    expect(json).toMatchObject({ type: 'object', properties: { kind: { enum: ['person', 'organization'] } } });
    expect(json).not.toHaveProperty('anyOf');
  });

  it('lässt Person und Organisation vollständig durch — die Art prüft der Dienst', () => {
    const person = { kind: 'person', firstName: 'Anna', lastName: 'Beispiel', city: 'Probestadt' };
    const org = { kind: 'organization', name: 'Beispielhilfe gGmbH', legalForm: 'gGmbH' };
    expect(schema.parse(person)).toEqual(person);
    expect(schema.parse(org)).toEqual(org);
  });
});
