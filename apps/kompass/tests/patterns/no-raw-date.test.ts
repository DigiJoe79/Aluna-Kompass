import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCommentLine, matchingLines, read, relative, sourceFiles, SRC } from './source';

/**
 * Ein Datum hat zwei Wege (K10 Charge 1, Spec § 2): Bildschirm über `formatDate`/`formatDateTime`
 * (`@/lib/dates`, `useDateFormat`), in Diensten `messageDate` — beides nach `ui.dateFormat`; Papier über
 * `paperDate`, fest TT.MM.JJJJ. Bis 0.2.7 schnitten Seiten ISO-Werte mit `.slice(0, 10)` ab, formatierten
 * mit `toLocaleString('de-DE')` an der Einstellung vorbei, und Dienste schrieben `bis 2036-12-31` in ihre
 * Meldungen. Alle drei Teile sind Heuristiken: Rechnen, Schlüssel, Dateinamen und gespeicherte Werte stehen mit
 * Grund in der Erlaubnisliste.
 */

/**
 * Erlaubnisliste mit Trefferzahl: Pfad → wie viele Treffer die Datei haben darf, und warum. Gebunden an die
 * Zahl statt an die ganze Datei, damit ein zusätzliches rohes Datum in einer freigegebenen Datei auffällt
 * (K10-Review, 2026-10-07). Weniger Treffer als erlaubt heißt: Die Ausnahme ist veraltet, die Zahl sinkt mit.
 */
type CountedAllowlist = Readonly<Record<string, { count: number; reason: string }>>;
type Hit = { where: string; file: string };

function checkAllowlist(hits: Hit[], allowed: CountedAllowlist): { unexpected: string[]; stale: string[] } {
  const byFile = new Map<string, Hit[]>();
  for (const hit of hits) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit]);
  const unexpected: string[] = [];
  for (const [file, found] of byFile) {
    const limit = allowed[file]?.count;
    if (limit === undefined) unexpected.push(...found.map(({ where }) => where));
    else if (found.length > limit) unexpected.push(`${file}: ${found.length} Treffer, erlaubt ${limit} (${found.map(({ where }) => where).join(', ')})`);
  }
  const stale = Object.entries(allowed).flatMap(([file, { count }]) => {
    const found = byFile.get(file)?.length ?? 0;
    return found < count ? [`${file}: ${found} Treffer, erlaubt ${count}`] : [];
  });
  return { unexpected, stale };
}

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
    expect(checkAllowlist([at('a.ts', 1), at('a.ts', 2)], allowed)).toEqual({ unexpected: [], stale: [] });
    expect(checkAllowlist([at('a.ts', 1), at('a.ts', 2), at('a.ts', 9)], allowed).unexpected).toEqual(['a.ts: 3 Treffer, erlaubt 2 (a.ts:1, a.ts:2, a.ts:9)']);
    expect(checkAllowlist([at('a.ts', 1)], allowed).stale).toEqual(['a.ts: 1 Treffer, erlaubt 2']);
    expect(checkAllowlist([at('b.ts', 4)], allowed)).toEqual({ unexpected: ['b.ts:4'], stale: ['a.ts: 0 Treffer, erlaubt 2'] });
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
});

describe('kein rohes Datum in der Oberfläche (Teil 1)', () => {
  const hits = [path.join(SRC, 'app'), path.join(SRC, 'components')]
    .flatMap((dir) => sourceFiles(dir))
    .flatMap((file) => matchingLines(file, read(file), RAW_UI_DATE).map((where) => ({ where, file: relative(file) })));

  it('Anzeigen gehen über formatDate/formatDateTime, Rechnen steht in der Erlaubnisliste', () => {
    expect(checkAllowlist(hits, UI_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkAllowlist(hits, UI_ALLOWED).stale).toEqual([]);
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
    expect(checkAllowlist(hits, PACKAGES_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkAllowlist(hits, PACKAGES_ALLOWED).stale).toEqual([]);
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
    expect(checkAllowlist(hits, TODAY_ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkAllowlist(hits, TODAY_ALLOWED).stale).toEqual([]);
  });
});
