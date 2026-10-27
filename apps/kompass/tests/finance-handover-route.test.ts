import { unwrap, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { startHandover } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerFixture } from '../../../packages/modules/finance/tests/helpers';

const state = vi.hoisted(() => ({ session: null as unknown, deps: null as unknown }));
vi.mock('next-intl/server', async () => {
  const messages = (await import('../messages/de.json')).default;
  return { getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) };
});
vi.mock('@/lib/request-context', () => ({ optionalSession: async () => state.session }));
vi.mock('@/lib/deps', () => ({ getDeps: () => state.deps }));

/** Übergabeprotokoll zum Unterschreiben (Plan C2 Task 8): Rechte und Antwort der Route. */
let f: Awaited<ReturnType<typeof ledgerFixture>>;
let handoverId: string;
beforeEach(async () => {
  f = await ledgerFixture({ years: ['2025', '2026'] });
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const person = async (lastName: string) => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName }));
  const from = await person('Kassierer');
  const to = await person('Nachfolgerin');
  handoverId = unwrap(await startHandover(f.deps, f.ctx, { handoverOn: '2026-06-30', fromContactId: from.id, toContactId: to.id })).id;
  state.deps = f.deps;
  state.session = { ctx: f.ctx };
});

const get = async (id: string) => (await import('@/app/finance/closing/handover/[id]/protocol/route')).GET(new Request(`http://x/finance/closing/handover/${id}/protocol`), { params: Promise.resolve({ id }) });

describe('GET /finance/closing/handover/[id]/protocol', () => {
  it('liefert das PDF als Anhang mit dem Namen des Dienstes, nie im Zwischenspeicher; 401, 403, 404', async () => {
    const res = await get(handoverId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="Uebergabeprotokoll-30\.06\.2026\.pdf"$/);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    state.session = null;
    expect((await get(handoverId)).status).toBe(401);
    state.session = { ctx: ctxWith([], f.userId) };
    expect((await get(handoverId)).status).toBe(403);
    state.session = { ctx: f.ctx };
    expect((await get('unbekannt')).status).toBe(404);
  });
});
