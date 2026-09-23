import { schema } from '@kompass/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_FIELDS, financeAudit } from '../src/audit';
import { setupFinance } from './helpers';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('financeAudit', () => {
  it('writes only whitelisted fields — a name or an IBAN never reaches the log', () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.account.create', entity: 'financeAccount', id: 'A1', after: { kind: 'bank', isMain: true, name: 'Sparkasse Musterstadt', iban: 'DE23999999990000202051', openingBalanceCents: 5000 }, summary: 'Konto A1 angelegt' }));
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(JSON.parse(entry.after as string)).toEqual({ kind: 'bank', isMain: true, openingBalanceCents: 5000 });
    expect(`${entry.after}${entry.summary}`).not.toMatch(/Sparkasse|DE02/);
    expect(entry).toMatchObject({ action: 'finance.account.create', entityType: 'financeAccount', entityId: 'A1' });
  });

  it('never lists a field that could carry a person, free text or a bank detail', () => {
    const forbidden = /name|label|title|description|note|text|reason|iban|bic|holder|purposeLine|contact|subject|email/i;
    const offenders = Object.entries(AUDIT_FIELDS).flatMap(([entity, fields]) => fields.filter((f) => forbidden.test(f)).map((f) => `${entity}.${f}`));
    expect(offenders).toEqual([]);
  });

  it('is the only place in the module that imports recordAudit', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}audit.ts`)).filter((f) => /\brecordAudit\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
