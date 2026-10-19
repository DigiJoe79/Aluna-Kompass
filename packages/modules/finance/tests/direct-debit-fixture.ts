import { coreModule, defineModule, newId, unwrap, writeSettingInternal, type CallContext, type DirectDebitSourceItem } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule, createContact } from '@kompass/module-contacts';
import { dmsModule, documents } from '@kompass/module-dms';
import { projectsModule } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { prepareMandate } from '../src/direct-debit/mandates';
import { createAccount } from '../src/ledger/accounts';
import { createOpenItem } from '../src/ledger/open-items';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';
import { financeSepaMandates, financeSepaPrenotifications, type PrenotificationPlanEntry } from '../src/schema';
import { insertDocument } from './helpers';

/**
 * Für die Einzüge (Plan L2): Finanzen mit Lastschrift eingerichtet (Gläubiger-ID, Hauptkonto mit IBAN) und ein
 * Testmodul `feesource`, das offene Posten über `directDebitSources` meldet — wie die Mitglieder, ohne sie zu laden.
 * `now` setzt die Uhr (Vorgabe Dienstag, 20.10.2026: Fenster 22.10. bis 03.11.).
 */
export async function directDebitFixture(opts: { now?: string } = {}) {
  const sources: DirectDebitSourceItem[] = [];
  const feeSource = defineModule({ key: 'feesource', version: '0', permissions: [], dependsOn: ['finance'], directDebitSources: (_deps, { until }) => sources.filter((s) => s.dueOn <= until) });
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule, feeSource], now: opts.now ?? '2026-10-20T08:00:00.000Z' });
  const write = (key: string, value: unknown) => deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value));
  write('modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'feesource']);
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  write('organization.name', 'Musterverein e.V.');
  write('finance.sepa.enabled', true);
  write('finance.sepa.creditorId', 'DE98ZZZ09999999999');
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  const ctx = ctxWith([...FINANCE_PERMISSIONS, 'dms.view', 'dms.create', 'dms.file'], userId);
  const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));

  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  let ibanCounter = 0;
  /** Ein Zahler mit Mandat; `signedOn` null lässt es vorbereitet. */
  const payer = async (lastName: string, o: { signedOn?: string | null; firstName?: string } = {}) => {
    const contact = unwrap(await createContact(deps, contactCtx, { kind: 'person', firstName: o.firstName ?? 'Erika', lastName }));
    ibanCounter += 1;
    const iban = IBANS[ibanCounter - 1]!;
    const mandate = unwrap(await prepareMandate(deps, ctx, { contactId: contact.id, debtorName: `${o.firstName ?? 'Erika'} ${lastName}`, iban }));
    const signedOn = o.signedOn === undefined ? '2026-01-15' : o.signedOn;
    if (signedOn) deps.db.update(financeSepaMandates).set({ signedOn }).where(eq(financeSepaMandates.id, mandate.id)).run();
    return { contactId: contact.id, mandateId: mandate.id, reference: mandate.reference, iban };
  };
  /** Ein offener Beitrag des Testmoduls: echter offener Posten, gemeldet über den Haken. */
  const fee = async (p: { contactId: string; mandateId: string }, amountCents: number, dueOn: string, remittance = 'Beitrag 2026 Mitglied 0001') => {
    const item = unwrap(await createOpenItem(deps, ctx, { kind: 'receivable', itemDate: '2026-01-01', contactId: p.contactId, amountCents, dueOn, paymentReference: remittance }));
    sources.push({ openItemId: item.id, mandateId: p.mandateId, amountCents, dueOn, remittance });
    return item.id;
  };
  /** Eine Ankündigung, direkt festgehalten (ein festgeschriebener Brief der Art `sepa-prenotification`). */
  const announce = (mandateId: string, plan: PrenotificationPlanEntry[], issuedOn = '2026-10-01') => {
    const documentId = insertDocument({ deps }, { subject: 'Ankündigung', typeKey: 'sepa-prenotification' });
    deps.db.update(documents).set({ documentDate: issuedOn }).where(eq(documents.id, documentId)).run();
    deps.db.insert(financeSepaPrenotifications).values({ id: newId(), mandateId, documentId, plan, createdByUserId: userId, createdAt: `${issuedOn}T10:00:00.000Z` }).run();
  };
  return { deps, ctx, userId, bank, write, sources, payer, fee, announce };
}
export type DirectDebitFixture = Awaited<ReturnType<typeof directDebitFixture>>;

/** Erfundene IBANs (Bankleitzahl 99999999) mit gültiger Prüfziffer. */
export const IBANS = ['DE44999999990532013000', 'DE78999999990000300001', 'DE51999999990000300002', 'DE24999999990000300003', 'DE94999999990000300004', 'DE67999999990000300005', 'DE40999999990000300006'];
