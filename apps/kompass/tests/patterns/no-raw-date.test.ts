import path from 'node:path';
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
  read,
  relative,
  sourceFiles,
  SRC,
} from './source';

/**
 * Ein Datum hat zwei Wege (K10 Charge 1, Spec § 2): Bildschirm über `formatDate`/`formatDateTime`
 * (`@/lib/dates`, `useDateFormat`), in Diensten `messageDate` — beides nach `ui.dateFormat`; Papier über
 * `paperDate`, fest TT.MM.JJJJ. Bis 0.2.7 schnitten Seiten ISO-Werte mit `.slice(0, 10)` ab, formatierten
 * mit `toLocaleString('de-DE')` an der Einstellung vorbei, und Dienste schrieben `bis 2036-12-31` in ihre
 * Meldungen. Alle vier Teile sind Heuristiken: Rechnen, Schlüssel, Dateinamen und gespeicherte Werte stehen mit
 * Grund in der Erlaubnisliste. Teil 4 (K10 Charge 2): Zeiten nicht über den Formatierer von next-intl.
 * Teile 5–7 (Durchsicht 0.2.11, Stufe 1, Auftrag 2): kein eigenes `Intl.DateTimeFormat`, kein ICU-Datum in der
 * Sprachdatei (fest TT.MM.JJJJ, an `ui.dateFormat` vorbei), kein ISO-Feld (`…On`/`…At`/`…Date`) roh im JSX.
 */

/** Teil 1 — Oberfläche: kein Abschneiden und kein Formatieren von Hand. */
const RAW_UI_DATE = /\.slice\(0, ?(?:10|16|19)\)|\btoLocale(?:Date|Time)?String\(|\btoISOString\(/;

/** Teil 2 — Pakete: kein roher Datumswert in einem Template-String (`${…On}`, `${…Date}`, `${…At}`, `${…Until}`, `${until}`, `${today}`, `${day}`, `${date}`). */
const RAW_DATE_INTERPOLATION = /\$\{\s*(?:\w+\??\.)*(?:\w*(?:On|Date|At|Until)|until|today|day|date)\s*\}/;

/**
 * Teil 3 — Pakete: „heute“ nie als UTC-Tag. Die ersten zehn Zeichen eines Zeitstempels sind der UTC-Tag —
 * zwischen Mitternacht und ein bzw. zwei Uhr deutscher Zeit noch gestern; ein Brief von 0:30 Uhr trüge den
 * Vortag (K10-Review R2, 2026-10-07). „Heute“ ist `todayIn(deps)`, ein Zeitpunkt wird über `isoDayIn` zum Tag.
 * Rechnen mit einem Tag (`d.toISOString().slice(0, 10)` nach `setUTCDate`) trifft das Muster nicht. Dasselbe gilt für
 * jeden gespeicherten Zeitstempel (`filedAt`, `createdAt`, `iso`): sein Tag kommt über `isoDayIn` bzw. in Berichten
 * über `zonedDayOf` (F-B3, 0.4.5 — zehn Anzeige-Stellen in den Finanzen zeigten am 01.01. um 0:30 Uhr den 31.12.).
 */
const RAW_TODAY = /(?:\bisoNow\([^)]*\)|(?<![\w.])now|\bnew Date\(\)\.toISOString\(\)|\.now\(\)\.toISOString\(\)|\b\w+At[!?]?|(?<![\w.])iso)\.slice\(0, ?10\)/;

/** Drizzle-Vorlagen setzen Spalten ein, keine Texte. */
const SQL_TEMPLATE = /\bsql(?:<[^>]*>)?`/;

/**
 * Teil 4 — Oberfläche: Zeiten nicht über next-intl (`useFormatter`/`getFormatter`). Die Zone stimmte dort,
 * `ui.dateFormat` aber nicht (Befund 0.2.8/22). Erkannt über Import **und** Bindung: Nur der Rückgabewert des
 * Formatierers zählt, damit `useFormatter` für Zahlen neben `fmt.dateTime` aus `useDateFormat` stehen darf.
 * Grenze: Ein Formatierer, der als Prop weitergereicht wird, ist unsichtbar (MUSTER § Datum).
 */
const INTL_FORMATTER_IMPORT = /\b(?:useFormatter|getFormatter)\b[\s\S]*?from\s+['"]next-intl(?:\/server)?['"]/;
const FORMATTER_CALL = String.raw`(?:await\s+)?(?:useFormatter|getFormatter)\(\)`;

function intlDateCallLines(source: string): number[] {
  if (!INTL_FORMATTER_IMPORT.test(source)) return [];
  const callees: RegExp[] = [new RegExp(String.raw`\(?${FORMATTER_CALL}\)?\.(?:dateTime|relativeTime)\(`)];
  for (const [, name] of source.matchAll(new RegExp(String.raw`(?:const|let)\s+(\w+)\s*=\s*${FORMATTER_CALL}`, 'g')))
    callees.push(new RegExp(String.raw`(?<![\w.])${name}\.(?:dateTime|relativeTime)\(`));
  for (const [, inner] of source.matchAll(new RegExp(String.raw`(?:const|let)\s*\{([^}]*)\}\s*=\s*${FORMATTER_CALL}`, 'g')))
    for (const part of inner!.split(',')) {
      const [key, alias] = part.split(':').map((s) => s.trim());
      if (key === 'dateTime' || key === 'relativeTime') callees.push(new RegExp(String.raw`(?<![\w.])${alias || key}\(`));
    }
  return source.split('\n').flatMap((line, index) => (!isCommentLine(line) && callees.some((re) => re.test(line)) ? [index + 1] : []));
}

export const UI_ALLOWED: CountedAllowlist = {
  'app/(shell)/dms/actions.ts': { count: 1, reason: 'Zeitstempel `savedAt` im Aktionszustand, keine Anzeige.' },
  'app/(shell)/dms/[id]/follow-ups-panel.tsx': { count: 1, reason: 'Rechnen: „in einer Woche“ als ISO-Vorgabewert.' },
  'app/(shell)/finance/reports/[key]/annual-accounts/request-signature-dialog.tsx': { count: 1, reason: 'Rechnen: „Fällig am“ in einer Woche als ISO-Vorgabewert wie im Wiedervorlage-Dialog der Akte.' },
};

export const PACKAGES_ALLOWED: CountedAllowlist = {
  'packages/core/src/backup/ring.ts': { count: 1, reason: 'Rechnen: Tage auf ISO-Tagen in UTC für die Prognose des Rings, keine Anzeige.' },
  'packages/core/src/backup/restore.ts': { count: 1, reason: '`system.lastImportSource` speichert Umgebung und Zeitstempel als Herkunftswert, keine Anzeige.' },
  'packages/core/src/documents/service.ts': { count: 1, reason: 'Rechnen: Ausstellungstag plus Uhrzeit zum Zeitstempel.' },
  'packages/modules/animals/src/print/service.ts': { count: 1, reason: 'Dateiname des Sammel-PDFs, ISO sortiert richtig.' },
  'packages/modules/dms/src/seed-pdf.ts': { count: 1, reason: '`xrefAt` ist ein Byte-Versatz im PDF, kein Datum.' },
  'packages/modules/finance/src/allocation/approvals.ts': { count: 1, reason: 'Rechnen: ISO-Tag zum Zeitpunkt.' },
  'packages/modules/finance/src/allocation/partner-proof.ts': { count: 1, reason: 'Rechnen: ISO-Tag zum Zeitpunkt.' },
  'packages/modules/finance/src/reporting/other-assets.ts': { count: 1, reason: 'Rechnen: Vortag eines ISO-Tags (`dayBefore`).' },
  'packages/modules/finance/src/allocation/templates/shared.ts': { count: 1, reason: 'Wortlaut der Verzichtserklärung; das Datum kommt schon als `paperDate`.' },
  'packages/modules/finance/src/dashboard.ts': { count: 1, reason: 'Rechnen: Tage zwischen zwei ISO-Tagen.' },
  'packages/modules/finance/src/auditing/anomalies.ts': { count: 2, reason: 'Rechnen: Tag danach und Ende des Folgemonats auf ISO-Tagen.' },
  'packages/modules/finance/src/zoned-days.ts': { count: 1, reason: 'Rechnen: Tag nach einem ISO-Tag für die Grenze eines Zeitraums in der Vereinszone (F-B3).' },
  'packages/modules/finance/src/direct-debit/runs.ts': { count: 1, reason: 'Dateiname der Bankdatei beim Herunterladen, ISO sortiert richtig.' },
  'packages/modules/finance/src/direct-debit/seed.ts': { count: 1, reason: 'Dateiname des erfundenen Kontoauszugs (Plan L3), ISO sortiert richtig.' },
  'packages/modules/finance/src/donations/templates/shared.ts': { count: 1, reason: '`placeDate` ist schon „Ort, paperDate“.' },
  'packages/modules/finance/src/donations/templates/wording.ts': { count: 4, reason: 'Amtlicher Wortlaut; die Daten kommen schon als `paperDate`.' },
  'packages/modules/finance/src/import/accounts.ts': { count: 1, reason: 'Rechnen: Tage zwischen zwei ISO-Tagen.' },
  'packages/modules/finance/src/import/camt-fixture.ts': { count: 2, reason: 'XML-Beispielauszug; ISO ist das Format der Bank.' },
  'packages/modules/finance/src/import/runs.ts': { count: 1, reason: 'Abgleichschlüssel einer Umsatzzeile.' },
  'packages/modules/finance/src/import/zugferd-fixture.ts': { count: 1, reason: 'XML-Beispielrechnung; ISO ist das Format des Standards.' },
  'packages/modules/finance/src/ledger/notice-validity.ts': { count: 1, reason: 'Rechnen: ISO-Tag zusammensetzen.' },
  'packages/modules/finance/src/ledger/vat-periods.ts': { count: 1, reason: 'Fingerabdruck der Zeilen eines Umsatzsteuer-Zeitraums (Hash-Eingabe), keine Anzeige.' },
  'packages/modules/finance/src/seed.ts': { count: 3, reason: 'Dateinamen der erfundenen Belege, ISO sortiert richtig; Buchungstag der frühen Jahre aus Jahr und Monat-Tag (Rechnen, Plan seed-mehrjahre).' },
  'packages/modules/governance/src/minutes/attachments.ts': { count: 2, reason: 'Rechnen: Sortierschlüssel aus ISO-Tag und Zeitstempel (jüngste Mitgliedschaft, Wahlen in Abstimmungsfolge).' },
  'packages/modules/governance/src/minutes/print.ts': { count: 1, reason: 'Dateiname des Protokoll-Entwurfs, ISO sortiert richtig.' },
  'packages/modules/governance/src/seal/member-proposals.ts': { count: 1, reason: 'Rechnen: Sortierschlüssel aus Sitzungstag und Beginn.' },
  'packages/modules/governance/src/statutes.ts': { count: 2, reason: 'Rechnen: Sortierschlüssel aus Eintragungs- und Beschlusstag der Satzungsstände.' },
};

/** Ausnahmen nur mit echtem Grund (Dateiname, Kennung). Bei Einführung leer: Die Probesuche fand nur Fehler. */
export const TODAY_ALLOWED: CountedAllowlist = {};

const UI_FILES = () => [path.join(SRC, 'app'), path.join(SRC, 'components')].flatMap((dir) => sourceFiles(dir));
const PACKAGE_FILES = () => packageSourceDirs().flatMap((dir) => sourceFiles(dir)).filter(isProductSource);

describe('Heuristik des Wächters', () => {
  it('die Erlaubnisliste zählt je Datei: ein Treffer mehr ist rot, einer weniger wird gemeldet', () => {
    const allowed: CountedAllowlist = { 'a.ts': { count: 2, reason: 'Rechnen.' } };
    const at = (file: string, line: number) => ({ where: `${file}:${line}`, file });
    expect(checkCountedAllowlist([at('a.ts', 1), at('a.ts', 2)], allowed)).toEqual({ unexpected: [], stale: [] });
    expect(checkCountedAllowlist([at('a.ts', 1), at('a.ts', 2), at('a.ts', 9)], allowed).unexpected).toEqual(['a.ts: 3 Treffer, erlaubt 2 (a.ts:1, a.ts:2, a.ts:9)']);
    expect(checkCountedAllowlist([at('a.ts', 1)], allowed).stale).toEqual(['a.ts: 1 Treffer, erlaubt 2']);
    expect(checkCountedAllowlist([at('b.ts', 4)], allowed)).toEqual({ unexpected: ['b.ts:4'], stale: ['a.ts: 0 Treffer, erlaubt 2'] });
  });

  it('Teil 1 trifft Abschneiden und Formatieren von Hand, nicht die Formatierer', () => {
    for (const hit of ["t('x', { date: confirmedAt.slice(0, 10) })", "new Date(a).toLocaleDateString('de-DE')", "new Date(a).toLocaleString('de-DE')", 'clock.now().toISOString()', "event.at.slice(0, 16).replace('T', ' ')"])
      expect(RAW_UI_DATE.test(hit), hit).toBe(true);
    for (const miss of ['fmt.date(confirmedAt)', 'name.slice(0, 1)', 'item.hash.slice(0, 12)', 'formatDateTime(at, mode)'])
      expect(RAW_UI_DATE.test(miss), miss).toBe(false);
  });

  it('Teil 2 trifft einen rohen Datumswert im Template-String, nicht den formatierten', () => {
    for (const hit of ['`bis ${until}`', '`zum ${v.dueAt} angelegt`', '`am ${v.supersededOn}`', '`(bis ${h.until})`', '`vom ${before.noticeDate}`', '`heute ${today}`'])
      expect(RAW_DATE_INTERPOLATION.test(hit), hit).toBe(true);
    for (const miss of ['`bis ${messageDate(deps, until)}`', '`(${messageDateTime(deps, at)})`', '`vom ${paperDate(v.countedOn)}`', '`vom ${dateText}`', '`${doc.number}`', '`${format}`'])
      expect(RAW_DATE_INTERPOLATION.test(miss), miss).toBe(false);
  });

  it('Teil 3 trifft „heute“ und Zeitstempel als UTC-Tag, nicht das Rechnen mit einem Tag', () => {
    for (const hit of ['documentDate ?? now.slice(0, 10)', 'isoNow(deps.clock).slice(0, 10)', 'new Date().toISOString().slice(0, 10)', 'deps.clock.now().toISOString().slice(0,10)', 'filedOn: filed.filedAt.slice(0, 10)', 'row.approvedAt!.slice(0, 10)', 'paperDate(iso.slice(0, 10) as never)'])
      expect(RAW_TODAY.test(hit), hit).toBe(true);
    for (const miss of ['todayIn(deps)', 'd.toISOString().slice(0, 10)', 'snow.slice(0, 10)', 'rows.slice(0, 10)', 'nowIso.slice(0, 10)', 'isoDayIn(deps, Date.parse(filed.filedAt))', 'String(value).slice(0, 10)', 'dataRows.slice(0, 10)'])
      expect(RAW_TODAY.test(miss), miss).toBe(false);
  });

  it('Drizzle-Vorlagen zählen nicht', () => {
    expect(SQL_TEMPLATE.test('sql`max(${financeEntries.entryDate})`')).toBe(true);
    expect(SQL_TEMPLATE.test('sql<string | null>`max(${financeEntries.entryDate})`')).toBe(true);
    expect(SQL_TEMPLATE.test('`Kassenzählung ${name}`')).toBe(false);
  });

  it('Teil 4 trifft Zeiten über den Formatierer von next-intl, gleich wie er heißt', () => {
    const client = (body: string) => `import { useFormatter } from 'next-intl';\nfunction A() {\n${body}\n}`;
    const server = (body: string) => `import { getFormatter } from 'next-intl/server';\nasync function A() {\n${body}\n}`;
    expect(intlDateCallLines(client('  const format = useFormatter();\n  return format.dateTime(d);'))).toEqual([4]);
    expect(intlDateCallLines(server('  const f = await getFormatter();\n  return f.dateTime(d, { dateStyle: "short" });'))).toEqual([4]);
    expect(intlDateCallLines(client('  const { dateTime } = useFormatter();\n  return dateTime(d);'))).toEqual([4]);
    expect(intlDateCallLines(client('  const { dateTime: when, number } = useFormatter();\n  return when(d) + number(1);'))).toEqual([4]);
    expect(intlDateCallLines(client('  const x = useFormatter();\n  return x.relativeTime(d);'))).toEqual([4]);
  });

  it('Teil 4 schlägt nicht an bei Zahlen über next-intl und Datum über useDateFormat in einer Datei', () => {
    const source = [
      "import { useFormatter } from 'next-intl';",
      "import { useDateFormat } from '@/components/date-format-provider';",
      'function A() {',
      '  const format = useFormatter();',
      '  const fmt = useDateFormat();',
      '  return `${format.number(n)} ${fmt.dateTime(d)} ${fmt.time(d)}`;',
      '}',
    ].join('\n');
    expect(intlDateCallLines(source)).toEqual([]);
    expect(intlDateCallLines('const fmt = useDateFormat();\nfmt.dateTime(d);')).toEqual([]);
  });
});

describe('kein rohes Datum in der Oberfläche (Teil 1)', () => {
  const hits = lineHits(UI_FILES(), (line) => RAW_UI_DATE.test(line));

  it('Anzeigen gehen über formatDate/formatDateTime, Rechnen steht in der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, UI_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(UI_ALLOWED, () => checkCountedAllowlist(hits, UI_ALLOWED).stale);
});

describe('kein rohes Datum in Meldungen der Pakete (Teil 2)', () => {
  const hits = lineHits(PACKAGE_FILES(), (line) => RAW_DATE_INTERPOLATION.test(line) && !SQL_TEMPLATE.test(line), fromRepo);

  it('Meldungen nehmen messageDate, Papier paperDate; Rechnen steht in der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, PACKAGES_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(PACKAGES_ALLOWED, () => checkCountedAllowlist(hits, PACKAGES_ALLOWED).stale);
});

describe('kein „heute“ als UTC-Tag in den Paketen (Teil 3)', () => {
  const hits = lineHits(PACKAGE_FILES(), (line) => RAW_TODAY.test(line), fromRepo);

  it('„heute“ ist todayIn(deps), ein Zeitpunkt wird über isoDayIn zum Tag', () => {
    expect(checkCountedAllowlist(hits, TODAY_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(TODAY_ALLOWED, () => checkCountedAllowlist(hits, TODAY_ALLOWED).stale);
});

/** Ausnahmen nur mit echtem Grund. Bei Einführung leer: alle Stellen gehen über `useDateFormat`/`dateFormatOf`. */
export const INTL_ALLOWED: CountedAllowlist = {};

describe('keine Zeiten über next-intl in der Oberfläche (Teil 4)', () => {
  const hits = UI_FILES().flatMap((file) => intlDateCallLines(read(file)).map((line) => ({ where: `${relative(file)}:${line}`, file: relative(file) })));

  it('Zeiten gehen über useDateFormat bzw. dateFormatOf', () => {
    expect(checkCountedAllowlist(hits, INTL_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(INTL_ALLOWED, () => checkCountedAllowlist(hits, INTL_ALLOWED).stale);
});

/** Teil 5 — kein eigenes `Intl.DateTimeFormat`: Formatieren gehört in `packages/core/src/dates.ts`. */
const INTL_DATE = /\bIntl\.DateTimeFormat\(/;
const INTL_DATE_OWNERS = new Set(['packages/core/src/dates.ts']);
export const INTL_DATE_ALLOWED: CountedAllowlist = {
  'apps/kompass/src/lib/audit-export.ts': { count: 1, reason: 'Export des Protokolls: festes TT.MM.JJJJ HH:mm:ss wie Papier, unabhängig von `ui.dateFormat` (Kommentar dort).' },
  'packages/core/src/today.ts': { count: 1, reason: 'Prüft, ob eine Zeitzone gültig ist; formatiert nichts.' },
  'apps/kompass/src/lib/settings-options.ts': { count: 1, reason: 'Nennt eine Zeitzone in der Auswahl der Stammdaten („Berlin (Mitteleuropäische Zeit)“, Runde 3, 149); formatiert kein Datum.' },
};

describe('kein eigenes Intl.DateTimeFormat (Teil 5)', () => {
  const files = [SRC, ...packageSourceDirs()].flatMap((dir) => sourceFiles(dir)).filter((file) => isProductSource(file) && !INTL_DATE_OWNERS.has(fromRepo(file)));
  const hits = lineHits(files, (line) => INTL_DATE.test(line), fromRepo);

  it('Datum und Uhrzeit über formatDate/formatDateTime/formatTime aus dem Kern', () => {
    expect(checkCountedAllowlist(hits, INTL_DATE_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(INTL_DATE_ALLOWED, () => checkCountedAllowlist(hits, INTL_DATE_ALLOWED).stale);
});

describe('kein ICU-Datum in der Sprachdatei (Teil 6)', () => {
  it('Daten gehen als fertiger Text an einen schlichten Platzhalter (messageValues in lib/error-text.ts)', () => {
    expect(messageTexts().filter(([, text]) => /,\s*(?:date|time)\s*[,}]/.test(text)).map(([key]) => key)).toEqual([]);
  });
});

/**
 * Teil 7 — Heuristik: ein Feld `…On`/`…At`/`…Date` als Kind im JSX (`{year.startsOn}`, `{x.filedOn ?? '—'}`), nicht als
 * Attribut und nicht in einem Formatierer. Ein Treffer, der kein Datum zeigt, kommt mit Grund in die Erlaubnisliste.
 */
const RAW_JSX_DATE = /(?<![=\w$])\{\s*[A-Za-z_][\w.?]*\.\w+(?:On|At|Date)\s*(?:\?\?[^}]*)?\}/;
export const JSX_DATE_ALLOWED: CountedAllowlist = {};

describe('Heuristik Teil 7', () => {
  it('trifft ein rohes ISO-Feld im JSX, nicht Attribut und Formatierer', () => {
    for (const hit of ['<td>{year.startsOn} – {year.endsOn}</td>', "<TableCell>{year.taxReturnFiledOn ?? '—'}</TableCell>", '<span>{doc?.sentAt}</span>'])
      expect(RAW_JSX_DATE.test(hit), hit).toBe(true);
    for (const miss of ['<input value={project.updatedAt} />', '{fmt.date(year.startsOn)}', '`${row.createdAt}`', 'key={`${a.id}-${a.updatedAt}`}'])
      expect(RAW_JSX_DATE.test(miss), miss).toBe(false);
  });
});

describe('kein rohes ISO-Feld im JSX (Teil 7)', () => {
  const hits = lineHits(UI_FILES().filter((file) => file.endsWith('.tsx')), (line) => RAW_JSX_DATE.test(line));

  it('Datum im JSX nur über fmt.date/fmt.dateTime', () => {
    expect(checkCountedAllowlist(hits, JSX_DATE_ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(JSX_DATE_ALLOWED, () => checkCountedAllowlist(hits, JSX_DATE_ALLOWED).stale);
});
