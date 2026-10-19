import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { maskIban } from '../src/format/iban';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { setupFinance } from './helpers';

const IBAN = 'DE44999999990532013000';
const tool = (name: string) => FINANCE_MCP_TOOLS.find((t) => t.name === name)!;
const L2_TOOLS = ['finance_direct_debit_window', 'finance_direct_debit_preview', 'finance_direct_debit_create', 'finance_direct_debit_remove_item', 'finance_direct_debit_build_file', 'finance_direct_debit_submitted', 'finance_direct_debit_reset_submitted', 'finance_direct_debit_cancel', 'finance_direct_debit_get', 'finance_direct_debit_list', 'finance_prenotification_issue'];
const TOOLS = ['finance_sepa_setup_state', 'finance_mandate_prepare', 'finance_mandate_correct', 'finance_mandate_activate', 'finance_mandate_amend', 'finance_mandate_end', 'finance_mandate_form', 'finance_mandate_get', 'finance_mandates_list', 'finance_pledge_save', 'finance_pledge_pause', 'finance_pledge_end', 'finance_pledge_get', 'finance_pledges_list'];

/** Plan L1 Task 7 — Agenten-Werkzeuge der Lastschrift. */
describe('direct debit MCP tools', () => {
  it('offers all fourteen tools; activate and end say they are human only', () => {
    for (const name of TOOLS) expect(tool(name), name).toBeDefined();
    for (const name of ['finance_mandate_activate', 'finance_mandate_end']) expect(tool(name).description).toMatch(/Human only/);
    expect(TOOLS.some((name) => tool(name).description.includes('finance.directDebit'))).toBe(true);
  });

  it('Plan L2: offers the collection tools; creating, the file, submitting, resetting and cancelling are human only; no tool hands out the file', () => {
    for (const name of L2_TOOLS) expect(tool(name), name).toBeDefined();
    for (const name of ['finance_direct_debit_create', 'finance_direct_debit_build_file', 'finance_direct_debit_submitted', 'finance_direct_debit_reset_submitted', 'finance_direct_debit_cancel']) expect(tool(name).description, name).toMatch(/Human only/);
    expect(tool('finance_direct_debit_build_file').description).toMatch(/never the file/);
    expect(FINANCE_MCP_TOOLS.some((t) => (t.service as { name?: string } | undefined)?.name === 'directDebitFileStream')).toBe(false);
  });

  it('Plan L3: lists the returns and resolves one only as a human; the suggestion tool names the credit of a collection', async () => {
    for (const name of ['finance_direct_debit_returns_list', 'finance_direct_debit_return_resolve']) expect(tool(name), name).toBeDefined();
    expect(tool('finance_direct_debit_return_resolve').description).toMatch(/Human only/);
    expect(tool('finance_direct_debit_return_resolve').description).toContain('finance.directDebit');
    expect(tool('finance_suggestion_get').description).toContain('directDebitRun');
    expect(tool('finance_suggestion_get').description).toContain('directDebitReturn');
    const { deps, ctx } = setupFinance();
    const agent: CallContext = { ...ctx, channel: 'mcp' };
    expect(unwrap(await tool('finance_direct_debit_returns_list').handler(deps, agent, { status: 'open' }))).toEqual({ items: [], total: 0 });
    expect(await tool('finance_direct_debit_return_resolve').handler(deps, agent, { returnId: 'R1', resolution: 'waive', endMandate: false })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
  });

  it('the window tool names today and the window of the bank', async () => {
    const { deps, ctx } = setupFinance();
    // Samstag, 05.09.: eingereicht zählt ab Montag, plus zwei Bankarbeitstage; bis ein Jahr voraus (04.09.2027, Samstag → 03.09.).
    const window = unwrap(await tool('finance_direct_debit_window').handler(deps, { ...ctx, channel: 'mcp' }, {})) as { today: string; earliest: string; latest: string; days: string[] };
    expect(window).toMatchObject({ today: '2026-09-05', earliest: '2026-09-09', latest: '2027-09-03' });
    expect(window.days.slice(0, 8)).toEqual(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
    expect(window.days.at(-1)).toBe('2027-09-03');
  });

  it('shows the IBAN like the screen: masked in the list, full in the detail; activation is refused for an agent', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const contactCtx: CallContext = { ...ctx, permissions: new Set(['contacts.manage']) };
    const payer = unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
    const agent: CallContext = { ...ctx, channel: 'mcp' };
    const prepared = unwrap(await tool('finance_mandate_prepare').handler(deps, agent, { contactId: payer.id, debtorName: 'Erika Beispiel', iban: IBAN })) as { id: string };
    const list = unwrap(await tool('finance_mandates_list').handler(deps, agent, { limit: 10, offset: 0 })) as { items: { iban: string }[] };
    expect(list.items.map((m) => m.iban)).toEqual([maskIban(IBAN)]);
    expect(unwrap(await tool('finance_mandate_get').handler(deps, agent, { id: prepared.id }))).toMatchObject({ iban: IBAN, state: 'pending' });
    expect(await tool('finance_mandate_activate').handler(deps, agent, { mandateId: prepared.id, signedOn: '2026-09-01', signedDocumentId: 'D1' })).toMatchObject({ ok: false, error: { code: 'humanOnly' } });
    expect(unwrap(await tool('finance_sepa_setup_state').handler(deps, agent, {}))).toEqual({ enabled: false, ready: false, missing: ['account'] });
  });
});
