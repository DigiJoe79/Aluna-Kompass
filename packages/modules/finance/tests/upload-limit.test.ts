import { writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { addEvidenceUpload } from '../src/allocation/evidence';
import { uploadExpenseReceipt } from '../src/allocation/expenses';
import { attachSignedWaiver } from '../src/allocation/waiver';
import { fileConfidentialityDeclaration } from '../src/auditing/auditors';
import { fileAuditReportScan } from '../src/auditing/filing';
import { fileSignedMandate } from '../src/direct-debit/forms';
import { attachSignedConfirmation } from '../src/donations/confirmations';
import { attachNoticeDocument } from '../src/donations/notices';
import { attachVoucherToTransaction } from '../src/import/vouchers';
import { uploadVoucher } from '../src/ledger/vouchers';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { ledgerFixture } from './helpers';

/**
 * K3 (0.4.5): Die Grenze `finance.uploadLimitMb` prüft der Belegdienst selbst — derselbe Code wie beim Kontoauszug
 * (`statementTooLarge`), für Oberfläche und MCP gleich. Jeder Dienst, den `voucherBytes` früher nur auf dem MCP-Weg
 * schützte, steht hier; die Ablehnung kommt vor jedem Nachschlagen, deshalb genügen erfundene IDs. Auslagen und
 * Nachweise nennen die Datei, wie bisher (`expenseFileTooLarge`).
 */
const SIX_MB = new Uint8Array(6 * 1024 * 1024);
const SERVICES: [string, (deps: never, ctx: never, input: unknown) => Promise<{ ok: boolean; error?: unknown }>, Record<string, unknown>, Record<string, unknown>?][] = [
  ['uploadVoucher', uploadVoucher as never, { entryId: 'E1', typeKey: 'voucher-invoice', documentDate: '2026-03-01' }],
  ['attachVoucherToTransaction', attachVoucherToTransaction as never, { rawTransactionId: 'R1' }],
  ['fileAuditReportScan', fileAuditReportScan as never, { fiscalYearId: 'Y1', fileName: 'bericht.pdf' }],
  ['fileConfidentialityDeclaration', fileConfidentialityDeclaration as never, { auditorId: 'A1' }],
  ['attachNoticeDocument', attachNoticeDocument as never, { id: 'N1' }],
  ['attachSignedConfirmation', attachSignedConfirmation as never, { id: 'C1' }],
  ['uploadExpenseReceipt', uploadExpenseReceipt as never, { claimId: 'C1', positionId: 'P1', fileName: 'beleg.pdf' }, { code: 'expenseFileTooLarge', params: { file: 'beleg.pdf', limit: '5 MB' } }],
  ['attachSignedWaiver', attachSignedWaiver as never, { claimId: 'C1' }],
  ['addEvidenceUpload', addEvidenceUpload as never, { paymentId: 'P1', kind: 'invoice', fileName: 'nachweis.pdf' }, { code: 'expenseFileTooLarge', params: { file: 'nachweis.pdf', limit: '5 MB' } }],
  ['fileSignedMandate', fileSignedMandate as never, { mandateId: 'M1', signedOn: '2026-03-01' }],
];

describe('K3 (0.4.5): Upload-Grenze für Belege im Dienst', () => {
  it.each(SERVICES)('%s refuses a file above finance.uploadLimitMb', async (_name, service, input, expected) => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.uploadLimitMb', 5));
    const result = await service(f.deps as never, f.ctx as never, { ...input, bytes: SIX_MB });
    expect(result.ok ? 'ok' : result.error).toMatchObject({ type: 'conflict', ...(expected ?? { code: 'statementTooLarge', params: { limit: '5' } }) });
  });

  it('the MCP tool answers with the same refusal as the screen — voucherBytes checks only base64', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.uploadLimitMb', 5));
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_notice_attach_document')!;
    const result = await tool.handler(f.deps, f.ctx, { id: 'N1', contentBase64: Buffer.from(SIX_MB).toString('base64') });
    expect(result.ok ? 'ok' : result.error).toMatchObject({ type: 'conflict', code: 'statementTooLarge' });
  });
});
