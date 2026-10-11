import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, read, relative, sourceFiles, SRC } from './source';

/**
 * Eine IBAN hat eine Stelle (Durchsicht 0.2.11, Stufe 1, Auftrag 4): `formatIban` (Vierergruppen mit geschütztem
 * Leerzeichen), `maskIban` (`DE ·· 3000`) und `compactIban` aus `@kompass/module-finance/format`. Bis 0.2.11 gab es vier Helfer mit
 * drei Darstellungen (Punkte, Sternchen, Gruppen) und acht Stellen, die die IBAN roh zeigten. Heuristik:
 * Teil 1 — ein Bezeichner `iban`/`…Iban` als Kind im JSX; Teil 2 — als Wert eines Satzes (`t('…', { iban: x.iban })`).
 */
const IBAN_ID = String.raw`[\w.?!]*\b(?:iban|\w+Iban)\b`;
const RAW_JSX_IBAN = new RegExp(String.raw`(?<![=\w$])\{\s*(?:${IBAN_ID}(?:\s*\?\?[^}]*)?|[\w.?!]+\s*\?\s*${IBAN_ID}\s*:[^}]*)\s*\}`);
const RAW_VALUE_IBAN = new RegExp(String.raw`(?:\bt\w*\(|\bvalues\s*:).*\b(?:iban|\w+Iban)\s*:\s*${IBAN_ID}(?!\s*\()`);

export const rawIban = (line: string): boolean => !isCommentLine(line) && !/^\s*import\b/.test(line) && (RAW_JSX_IBAN.test(line) || RAW_VALUE_IBAN.test(line));

/** Bei Einführung leer. `ibanMasked` (Auslagen) trifft das Muster nicht: Der Dienst liefert ihn schon über `maskIban`. */
const ALLOWED: CountedAllowlist = {};

describe('Heuristik', () => {
  it('trifft die rohe IBAN im JSX und im Satz', () => {
    for (const hit of ['<TableCell>{row.iban ?? <Empty />}</TableCell>', '<dd>{first.counterpartyIban}</dd>', '<span>{revealed ? account.iban : maskIban(account.iban)}</span>', "label={t('iban', { iban: form.iban })}", "parts.push({ key: 'iban', values: { iban: rule.counterpartyIban } });"])
      expect(rawIban(hit), hit).toBe(true);
  });
  it('trifft nicht die drei Funktionen, Attribute und Abbildungen', () => {
    for (const miss of ['<span>{formatIban(row.iban)}</span>', '<span>{revealed ? formatIban(account.iban) : maskIban(account.iban)}</span>', 'iban={claim.iban}', '{ id: a.id, iban: a.iban }', "t('iban', { iban: formatIban(form.iban) })", "{t('ibanReveal')}"])
      expect(rawIban(miss), miss).toBe(false);
  });
});

describe('IBAN nur über formatIban/maskIban', () => {
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components'), path.join(SRC, 'lib')]
    .flatMap((dir) => sourceFiles(dir))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (rawIban(line) ? [{ where: `${relative(file)}:${index + 1}`, file: relative(file) }] : [])),
    );

  it('keine rohe IBAN in der Anzeige; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).stale).toEqual([]);
  });
});
