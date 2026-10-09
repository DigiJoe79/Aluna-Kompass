import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, matchingLines, read, relative, sourceFiles, SRC } from './source';

/**
 * Ein Datum hat zwei Wege (K10 Charge 1, Spec § 2): Bildschirm über `formatDate`/`formatDateTime`
 * (`@/lib/dates`, `useDateFormat`), in Diensten `messageDate` — beides nach `ui.dateFormat`; Papier über
 * `paperDate`, fest TT.MM.JJJJ. Bis 0.2.7 schnitten Seiten ISO-Werte mit `.slice(0, 10)` ab, formatierten
 * mit `toLocaleString('de-DE')` an der Einstellung vorbei, und Dienste schrieben `bis 2036-12-31` in ihre
 * Meldungen. Alle vier Teile sind Heuristiken: Rechnen, Schlüssel, Dateinamen und gespeicherte Werte stehen mit
 * Grund in der Erlaubnisliste. Teil 4 (K10 Charge 2): Zeiten nicht über den Formatierer von next-intl.
 */

/** Teil 1 — Oberfläche: kein Abschneiden und kein Formatieren von Hand. */
const RAW_UI_DATE = /\.slice\(0, ?(?:10|16|19)\)|\btoLocale(?:Date|Time)?String\(|\btoISOString\(/;

/** Teil 2 — Pakete: kein roher Datumswert in einem Template-String (`${…On}`, `${…Date}`, `${…At}`, `${…Until}`, `${until}`, `${today}`, `${day}`, `${date}`). */
const RAW_DATE_INTERPOLATION = /\$\{\s*(?:\w+\??\.)*(?:\w*(?:On|Date|At|Until)|until|today|day|date)\s*\}/;

/**
 * Teil 3 — Pakete: „heute“ nie als UTC-Tag. Die ersten zehn Zeichen eines Zeitstempels sind der UTC-Tag —
 * zwischen Mitternacht und ein bzw. zwei Uhr deutscher Zeit noch gestern; ein Brief von 0:30 Uhr trüge den
 * Vortag (K10-Review R2, 2026-10-07). „Heute“ ist `todayIn(deps)`, ein Zeitpunkt wird über `isoDayIn` zum Tag.
 * Rechnen mit einem Tag (`d.toISOString().slice(0, 10)` nach `setUTCDate`) trifft das Muster nicht.
 */
const RAW_TODAY = /(?:\bisoNow\([^)]*\)|(?<![\w.])now|\bnew Date\(\)\.toISOString\(\)|\.now\(\)\.toISOString\(\))\.slice\(0, ?10\)/;

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

const UI_ALLOWED: CountedAllowlist = {
  'app/(shell)/dms/actions.ts': { count: 1, reason: 'Zeitstempel `savedAt` im Aktionszustand, keine Anzeige.' },
  'app/(shell)/dms/[id]/follow-ups-panel.tsx': { count: 1, reason: 'Rechnen: „in einer Woche“ als ISO-Vorgabewert.' },
};

const PACKAGES_ALLOWED: CountedAllowlist = {
  'core/src/backup/import.ts': { count: 1, reason: '`system.lastImportSource` speichert Umgebung und Zeitstempel als Herkunftswert, keine Anzeige.' },
  'core/src/documents/service.ts': { count: 1, reason: 'Rechnen: Ausstellungstag plus Uhrzeit zum Zeitstempel.' },
  'modules/animals/src/print/service.ts': { count: 1, reason: 'Dateiname des Sammel-PDFs, ISO sortiert richtig.' },
  'modules/dms/src/seed-pdf.ts': { count: 1, reason: '`xrefAt` ist ein Byte-Versatz im PDF, kein Datum.' },
  'modules/finance/src/allocation/approvals.ts': { count: 1, reason: 'Rechnen: ISO-Tag zum Zeitpunkt.' },
  'modules/finance/src/allocation/partner-proof.ts': { count: 1, reason: 'Rechnen: ISO-Tag zum Zeitpunkt.' },
  'modules/finance/src/allocation/templates/shared.ts': { count: 1, reason: 'Wortlaut der Verzichtserklärung; das Datum kommt schon als `paperDate`.' },
  'modules/finance/src/dashboard.ts': { count: 1, reason: 'Rechnen: Tage zwischen zwei ISO-Tagen.' },
  'modules/finance/src/donations/templates/shared.ts': { count: 1, reason: '`placeDate` ist schon „Ort, paperDate“.' },
  'modules/finance/src/donations/templates/wording.ts': { count: 4, reason: 'Amtlicher Wortlaut; die Daten kommen schon als `paperDate`.' },
  'modules/finance/src/import/accounts.ts': { count: 1, reason: 'Rechnen: Tage zwischen zwei ISO-Tagen.' },
  'modules/finance/src/import/camt-fixture.ts': { count: 2, reason: 'XML-Beispielauszug; ISO ist das Format der Bank.' },
  'modules/finance/src/import/runs.ts': { count: 1, reason: 'Abgleichschlüssel einer Umsatzzeile.' },
  'modules/finance/src/import/zugferd-fixture.ts': { count: 1, reason: 'XML-Beispielrechnung; ISO ist das Format des Standards.' },
  'modules/finance/src/ledger/notice-validity.ts': { count: 1, reason: 'Rechnen: ISO-Tag zusammensetzen.' },
  'modules/finance/src/seed.ts': { count: 2, reason: 'Dateinamen der erfundenen Belege, ISO sortiert richtig.' },
};

/** Ausnahmen nur mit echtem Grund (Dateiname, Kennung). Bei Einführung leer: Die Probesuche fand nur Fehler. */
const TODAY_ALLOWED: CountedAllowlist = {};

const PACKAGES = path.resolve(SRC, '../../../packages');
const fromPackages = (file: string) => path.relative(PACKAGES, file).split(path.sep).join('/');
const packageSourceDirs = () =>
  readdirSync(PACKAGES)
    .flatMap((name) => (name === 'modules' ? readdirSync(path.join(PACKAGES, 'modules')).map((m) => path.join(PACKAGES, 'modules', m, 'src')) : [path.join(PACKAGES, name, 'src')]))
    .filter((dir) => existsSync(dir));

describe('Heuristik des Wächters', () => {
  it('die Erlaubnisliste zählt je Datei: ein Treffer mehr ist rot, einer weniger veraltet', () => {
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

  it('Teil 3 trifft „heute“ als UTC-Tag, nicht das Rechnen mit einem Tag', () => {
    for (const hit of ['documentDate ?? now.slice(0, 10)', 'isoNow(deps.clock).slice(0, 10)', 'new Date().toISOString().slice(0, 10)', 'deps.clock.now().toISOString().slice(0,10)'])
      expect(RAW_TODAY.test(hit), hit).toBe(true);
    for (const miss of ['todayIn(deps)', 'd.toISOString().slice(0, 10)', 'snow.slice(0, 10)', 'rows.slice(0, 10)', 'nowIso.slice(0, 10)'])
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
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .flatMap((file) => matchingLines(file, read(file), RAW_UI_DATE).map((where) => ({ where, file: relative(file) })));

  it('Anzeigen gehen über formatDate/formatDateTime, Rechnen steht in der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, UI_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, UI_ALLOWED).stale).toEqual([]);
  });
});

describe('kein rohes Datum in Meldungen der Pakete (Teil 2)', () => {
  const hits = packageSourceDirs()
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => !/\.test\.tsx?$/.test(file) && !fromPackages(file).includes('/src/testing/'))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (RAW_DATE_INTERPOLATION.test(line) && !SQL_TEMPLATE.test(line) && !isCommentLine(line) ? [{ where: `${fromPackages(file)}:${index + 1}`, file: fromPackages(file) }] : [])),
    );

  it('Meldungen nehmen messageDate, Papier paperDate; Rechnen steht in der Erlaubnisliste', () => {
    expect(checkCountedAllowlist(hits, PACKAGES_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, PACKAGES_ALLOWED).stale).toEqual([]);
  });
});

describe('kein „heute“ als UTC-Tag in den Paketen (Teil 3)', () => {
  const hits = packageSourceDirs()
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => !/\.test\.tsx?$/.test(file) && !fromPackages(file).includes('/src/testing/'))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (RAW_TODAY.test(line) && !isCommentLine(line) ? [{ where: `${fromPackages(file)}:${index + 1}`, file: fromPackages(file) }] : [])),
    );

  it('„heute“ ist todayIn(deps), ein Zeitpunkt wird über isoDayIn zum Tag', () => {
    expect(checkCountedAllowlist(hits, TODAY_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, TODAY_ALLOWED).stale).toEqual([]);
  });
});

/** Ausnahmen nur mit echtem Grund. Bei Einführung leer: alle Stellen gehen über `useDateFormat`/`dateFormatOf`. */
const INTL_ALLOWED: CountedAllowlist = {};

describe('keine Zeiten über next-intl in der Oberfläche (Teil 4)', () => {
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .flatMap((file) => intlDateCallLines(read(file)).map((line) => ({ where: `${relative(file)}:${line}`, file: relative(file) })));

  it('Zeiten gehen über useDateFormat bzw. dateFormatOf', () => {
    expect(checkCountedAllowlist(hits, INTL_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, INTL_ALLOWED).stale).toEqual([]);
  });
});
