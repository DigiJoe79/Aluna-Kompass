import { describe, expect, it } from 'vitest';
import {
  allowlistHygiene,
  checkCountedAllowlist,
  type CountedAllowlist,
  fromRepo,
  isCommentLine,
  isProductSource,
  lineHits,
  messageTexts,
  packageSourceDirs,
  sourceFiles,
  SRC,
} from './source';

/**
 * Ein Betrag hat eine Stelle (Durchsicht 0.2.11, Stufe 1, Auftrag 1): `formatEuro`/`formatAmount` aus
 * `@kompass/module-finance/format` (`packages/modules/finance/src/format/amount.ts`), in der App über `@/lib/finance/amount`. Minus U+2212,
 * geschütztes Leerzeichen vor „€“. Bis 0.2.11 gab es eine zweite `formatEuro` im Finanzmodul (Minus U+002D),
 * ICU-Skelette `::currency` in der Sprachdatei und `toFixed(2).replace('.', ',')` in Masken. Heuristik: Zahlen,
 * die kein Betrag sind (Kontrast, Megabyte, Bildausschnitt, Normformate), stehen mit Grund in der Erlaubnisliste.
 */
const RAW_AMOUNT = /\.toFixed\(|\bIntl\.NumberFormat\(|\.toLocaleString\(\s*['"]de-DE['"]|::currency|\(\?=\(\\d\{3\}\)\+/g;

export function rawAmountCount(line: string): number {
  return isCommentLine(line) ? 0 : (line.match(RAW_AMOUNT) ?? []).length;
}

/** Pfade relativ zum Repo. Ausgenommen ist nur die Funktion selbst. */
const OWNER = 'packages/modules/finance/src/format/amount.ts';

export const ALLOWED: CountedAllowlist = {
  'apps/kompass/src/components/finance/invoice-card.tsx': { count: 1, reason: 'Steuersatz in Prozent, kein Betrag.' },
  'apps/kompass/src/lib/audit-sentences.ts': { count: 1, reason: 'Dateigröße in Megabyte im Protokollsatz, kein Betrag.' },
  'apps/kompass/src/app/(shell)/admin/themes/theme-editor.tsx': { count: 2, reason: 'Kontrastverhältnis eines Themes, kein Betrag.' },
  'apps/kompass/src/app/(shell)/admin/media/types.ts': { count: 1, reason: 'Dateigröße in Megabyte, kein Betrag.' },
  'apps/kompass/src/lib/crop-geometry.ts': { count: 5, reason: 'Rechnen: Bildausschnitt runden, Seitenverhältnis als Schlüssel.' },
  'packages/modules/site/src/pipeline/jobs.ts': { count: 1, reason: 'Dateigröße in Megabyte im Protokoll des Webseitenbaus, kein Betrag.' },
  'packages/modules/finance/src/ledger/epc-qr.ts': { count: 1, reason: 'EPC-QR-Code: Der Standard verlangt „EUR12.50“ mit Punkt, keine Anzeige.' },
  'packages/modules/finance/src/import/vouchers.ts': { count: 1, reason: 'Suchschreibweisen eines Betrags im Belegtext, keine Anzeige.' },
  'packages/modules/dms/src/seed-pdf.ts': { count: 1, reason: 'Erfundene Seed-Rechnung als PDF-Inhalt; ohne Tausenderpunkt wie eine fremde Rechnung, keine Anzeige.' },
  'packages/modules/finance/src/typst-pure.ts': {
    count: 1,
    reason: 'PDF der Zuwendungsbestätigungen und Verzichtserklärung: normales Leerzeichen vor „€“, kein Vorzeichen; `formatEuro` änderte mehr als das Vorzeichen (Spec Stufe 1 § 2 Auftrag 1).',
  },
};

describe('Heuristik', () => {
  it('trifft Betragsformatierung von Hand', () => {
    for (const hit of ["(c / 100).toFixed(2).replace('.', ',')", "new Intl.NumberFormat('de-DE', { style: 'currency' })", "euros.toLocaleString('de-DE')", '{amount, number, ::currency/EUR scale/0.01}', "String(e).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')"])
      expect(rawAmountCount(hit), hit).toBe(1);
  });
  it('trifft nicht formatEuro/formatAmount und keine Kommentare', () => {
    for (const miss of ['formatEuro(cents)', 'formatAmount(cents, { sign: "always" })', '// toFixed(2) war hier', 'value.toLocaleString()'])
      expect(rawAmountCount(miss), miss).toBe(0);
  });
});

describe('Beträge nur über formatEuro/formatAmount', () => {
  // App und Fachmodule; Kern und übrige Pakete liegen außerhalb dieses Wächters.
  const files = [SRC, ...packageSourceDirs().filter((dir) => fromRepo(dir).startsWith('packages/modules/'))].flatMap((dir) => sourceFiles(dir)).filter((file) => isProductSource(file) && fromRepo(file) !== OWNER);
  const hits = lineHits(files, rawAmountCount, fromRepo);

  it('keine eigene Betragsformatierung; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);

  it('die Sprachdatei formatiert keine Beträge (kein ICU `::currency`)', () => {
    expect(messageTexts().filter(([, text]) => text.includes('::currency')).map(([key]) => key)).toEqual([]);
  });
});
