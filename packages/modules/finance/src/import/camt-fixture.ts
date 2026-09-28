/**
 * Ein kleiner, gültiger CAMT.053-Text von Hand — für die Entwicklungsdaten
 * (`seedFinance`) und, davon abgeleitet, die Fixtures der Kontoauszug-E2E
 * (`apps/kompass/e2e/fixtures/camt/`). Bewusst kein Werkzeug: der Seed läuft
 * auch in Unit-Tests und im E2E-Reset, ganz ohne Bank oder Zusatzpaket —
 * Muster `textPdf` aus `@kompass/module-dms`.
 *
 * Erfunden im Sinn von `tests/fixtures/camt/`: erfundene Bank (BLZ 99999999),
 * erfundene Namen, keine echten IBANs von Personen.
 */

export interface CamtFixtureLine {
  /** Eingang +, Ausgang − — wie `CamtLine.amountCents`. */
  amountCents: number;
  bookingDate: string;
  valueDate?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  purpose?: string;
  /** Ohne Angabe trägt die Zeile keine Bankreferenz — Dublettenschutz läuft dann über Kerndaten und Zeitraum. */
  bankReference?: string;
  endToEndId?: string;
  returnCode?: string;
  pending?: boolean;
}

export interface CamtFixtureInput {
  iban: string;
  from: string;
  to: string;
  openingCents: number;
  /** Ohne Angabe: Anfang plus Summe der nicht vorgemerkten Zeilen (die Faustprobe, die `parseCamt053` selbst prüft). */
  closingCents?: number;
  version?: '001.02' | '001.08';
  msgId?: string;
  stmtId?: string;
  lines: CamtFixtureLine[];
}

const cents = (value: number): string => {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function balance(code: 'OPBD' | 'CLBD', amountCents: number, date: string): string {
  const sign = amountCents < 0 ? 'DBIT' : 'CRDT';
  return `<Bal><Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${cents(Math.abs(amountCents))}</Amt><CdtDbtInd>${sign}</CdtDbtInd><Dt><Dt>${date}</Dt></Dt></Bal>`;
}

function entry(line: CamtFixtureLine): string {
  const sign = line.amountCents < 0 ? 'DBIT' : 'CRDT';
  const amount = cents(Math.abs(line.amountCents));
  const valueDate = line.valueDate ?? line.bookingDate;
  const status = line.pending ? 'PDNG' : 'BOOK';
  const partyTag = line.amountCents < 0 ? 'Cdtr' : 'Dbtr';
  const acctTag = line.amountCents < 0 ? 'CdtrAcct' : 'DbtrAcct';
  const party = line.counterpartyName
    ? `<RltdPties><${partyTag}><Nm>${escapeXml(line.counterpartyName)}</Nm></${partyTag}>${line.counterpartyIban ? `<${acctTag}><Id><IBAN>${line.counterpartyIban}</IBAN></Id></${acctTag}>` : ''}</RltdPties>`
    : '';
  const returnInf = line.returnCode ? `<RtrInf><Rsn><Cd>${escapeXml(line.returnCode)}</Cd></Rsn></RtrInf>` : '';
  const endToEnd = line.endToEndId ? `<EndToEndId>${escapeXml(line.endToEndId)}</EndToEndId>` : '<EndToEndId>NOTPROVIDED</EndToEndId>';
  const acctSvcrRef = line.bankReference ? `<AcctSvcrRef>${escapeXml(line.bankReference)}</AcctSvcrRef>` : '';
  return (
    `<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${sign}</CdtDbtInd><Sts>${status}</Sts>` +
    `<BookgDt><Dt>${line.bookingDate}</Dt></BookgDt><ValDt><Dt>${valueDate}</Dt></ValDt>${acctSvcrRef}` +
    `<NtryDtls><TxDtls><Refs>${endToEnd}</Refs>${party}<RmtInf><Ustrd>${escapeXml(line.purpose ?? '')}</Ustrd></RmtInf>${returnInf}<Amt Ccy="EUR">${amount}</Amt></TxDtls></NtryDtls></Ntry>`
  );
}

/** Baut den Text einer einzelnen `Stmt` (ein Kontoauszug, ein Tag oder Zeitraum) als CAMT.053-XML. */
export function buildCamt053(input: CamtFixtureInput): string {
  const version = input.version ?? '001.02';
  const bookedSum = input.lines.filter((l) => !l.pending).reduce((sum, l) => sum + l.amountCents, 0);
  const closingCents = input.closingCents ?? input.openingCents + bookedSum;
  const msgId = input.msgId ?? `MSG-${input.stmtId ?? input.from}`;
  const stmtId = input.stmtId ?? `STMT-${input.from}`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.${version}">` +
    `<BkToCstmrStmt><GrpHdr><MsgId>${escapeXml(msgId)}</MsgId><CreDtTm>${input.from}T08:00:00</CreDtTm></GrpHdr>` +
    `<Stmt><Id>${escapeXml(stmtId)}</Id><Acct><Id><IBAN>${input.iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>` +
    `${balance('OPBD', input.openingCents, input.from)}${balance('CLBD', closingCents, input.to)}` +
    `${input.lines.map((line) => entry(line)).join('')}` +
    `</Stmt></BkToCstmrStmt></Document>`
  );
}

/** Wie `buildCamt053`, aber schon als UTF-8-Bytes — der Weg, den `importStatement` erwartet. */
export function buildCamt053Bytes(input: CamtFixtureInput): Uint8Array {
  return new TextEncoder().encode(buildCamt053(input));
}
