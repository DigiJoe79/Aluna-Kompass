import { describe, expect, it } from 'vitest';
import { lineOf, read, relative, sourceFiles, type Allowlist } from './source';

/**
 * Die Speicherleiste einer Seite klebt ab 640 × 600 px am unteren Rand (docs/MUSTER.md § B). Das tut sie nur, wenn
 * kein Vorfahre ein Scrollbereich ist: `overflow-hidden`, `-auto` oder `-scroll` machen ihn dazu, und die Leiste
 * klebt dann an ihm statt am Fenster — also nie. So war es bis 0.2.9 auf den meisten Formularseiten, seit 0.1.0
 * (Befund 39). Die Formularkarte ist deshalb `FormCard` mit `overflow-clip` (Designer 2026-10-08).
 *
 * Geprüft wird je Datei mit einer Heuristik über die JSX-Verschachtelung: Ein `FormActionBar` ohne
 * `placement="dialog"` und ohne `cancel` steht in einer `FormCard`, und keiner seiner Vorfahren in derselben Datei
 * setzt `overflow-hidden/auto/scroll` (auch nicht die `FormCard` selbst). Vorfahren in einer anderen Datei (die Seite
 * um ein Formular) sieht der Wächter nicht — dafür steht der E2E-Test an „Einstellungen → Verein“
 * (`e2e/settings.spec.ts`), der die Lage im Fenster misst.
 */

/**
 * Vorgangsmasken und Arbeitsflächen ohne Formularkarte: Die Leiste steht dort unter mehreren Karten oder am Ende
 * einer eigenen Scrollspalte. Eine `FormCard` darum wäre Karte in der Karte (MUSTER § E).
 */
const WITHOUT_CARD: Allowlist = {
  'app/(shell)/dms/new/draft-form.tsx': 'Brief schreiben: Arbeitsfläche mit Vorschau; die Leiste klebt am Ende der eigenen Scrollspalte (draft-screen.tsx).',
  'app/(shell)/finance/donations/run/run-selection.tsx': 'Sammelbestätigung (mode run): Fußleiste unter Auswahl und Vorschau-Gruppen, keine Formularkarte.',
  'app/(shell)/finance/entries/entry-form.tsx': 'Buchung: Vorgangsmaske aus mehreren Karten (Text, Konto, Aufteilung, Belege); die Leiste steht unter ihnen.',
  'app/(shell)/finance/expenses/new/expense-form.tsx': 'Auslage: Vorgangsmaske aus Positionen und Erstattungskarte; die Leiste steht unter ihnen.',
  'app/(shell)/finance/partners/[id]/payments/[paymentId]/draft-form.tsx': 'Zahlung an Partner: Vorgangsmaske aus Nachweis- und Positionskarten; die Leiste steht unter ihnen.',
  'components/finance/approval-detail-frame.tsx': 'Freigabe-Detail (mode run): Kopf-Kasten, Inhalt und Voraussetzungen, die Leiste darunter im Detailbereich.',
};

const SCROLLER = /\boverflow(?:-[xy])?-(?:hidden|auto|scroll)\b/;

type Tag = { name: string; index: number; text: string; selfClosing: boolean; closing: boolean };

/**
 * Öffnende, schließende und selbstschließende JSX-Tags in Reihenfolge. Ein öffnendes `<` gilt nur nach Leerraum
 * oder einem der Zeichen `( { } > ? : & | , =` als Tag — `useState<Kontakt>` ist ein Typ, kein Element.
 */
export function jsxTags(text: string): Tag[] {
  const tags: Tag[] = [];
  const start = /(?:(?<=[\s({}>?:&|,=]|^)<|<(\/))([A-Za-z][\w.]*)(?=[\s/>])/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 0;
    let quote: string | null = null;
    let end = m.index + m[0].length;
    for (; end < text.length; end += 1) {
      const ch = text[end]!;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }
    const tagText = text.slice(m.index, end + 1);
    tags.push({ name: m[2]!, index: m.index, text: tagText, closing: m[1] === '/', selfClosing: tagText.endsWith('/>') });
  }
  return tags;
}

/** Die offenen Elemente (außen zuerst) an der Stelle `index`. */
function ancestorsAt(tags: Tag[], index: number): Tag[] {
  const stack: Tag[] = [];
  for (const tag of tags) {
    if (tag.index >= index) break;
    if (tag.selfClosing) continue;
    if (!tag.closing) stack.push(tag);
    else {
      const at = stack.map((t) => t.name).lastIndexOf(tag.name);
      if (at !== -1) stack.length = at;
    }
  }
  return stack;
}

/** Leisten der Seite: ohne `placement="dialog"` und ohne `cancel` (dann gälte `dialog`). */
const isPageBar = (tag: Tag) => tag.name === 'FormActionBar' && !tag.closing && !/\bplacement="dialog"/.test(tag.text) && !/\bcancel=/.test(tag.text);

export type BarFinding = { line: number; problem: 'noCard' | 'scroller' };

export function pageBarFindings(text: string): BarFinding[] {
  const tags = jsxTags(text);
  return tags.filter(isPageBar).flatMap((bar) => {
    const ancestors = ancestorsAt(tags, bar.index);
    const line = lineOf(text, bar.index);
    const found: BarFinding[] = [];
    if (!ancestors.some((tag) => tag.name === 'FormCard')) found.push({ line, problem: 'noCard' });
    if (ancestors.some((tag) => SCROLLER.test(tag.text))) found.push({ line, problem: 'scroller' });
    return found;
  });
}

/** `FormCard` bringt `overflow-clip` mit; ein `overflow-hidden` an der Aufrufstelle höbe das wieder auf. */
export function scrollingCards(text: string): number[] {
  return jsxTags(text)
    .filter((tag) => tag.name === 'FormCard' && !tag.closing && SCROLLER.test(tag.text))
    .map((tag) => lineOf(text, tag.index));
}

describe('Formularkarte und klebende Speicherleiste', () => {
  const files = sourceFiles().filter((file) => !relative(file).startsWith('components/forms/form-action-bar'));
  const findings = files.flatMap((file) => pageBarFindings(read(file)).map((finding) => ({ file: relative(file), ...finding })));

  it('jede Speicherleiste einer Seite steht in einer FormCard (oder in der Erlaubnisliste)', () => {
    const missing = findings.filter((f) => f.problem === 'noCard' && !(f.file in WITHOUT_CARD)).map((f) => `${f.file}:${f.line}`);
    expect(missing, 'Formularkarte als FormCard (MUSTER § B/§ E) oder Eintrag mit Grund in WITHOUT_CARD').toEqual([]);
  });

  it('kein Vorfahre einer Speicherleiste ist ein Scrollbereich', () => {
    const scrollers = findings.filter((f) => f.problem === 'scroller').map((f) => `${f.file}:${f.line}`);
    expect(scrollers, 'overflow-hidden/auto/scroll über einer klebenden Leiste hält sie fest — overflow-clip über FormCard').toEqual([]);
  });

  it('keine FormCard setzt overflow-hidden, -auto oder -scroll', () => {
    expect(files.flatMap((file) => scrollingCards(read(file)).map((line) => `${relative(file)}:${line}`))).toEqual([]);
  });

  it('die Erlaubnisliste ist nicht veraltet', () => {
    const stale = Object.keys(WITHOUT_CARD).filter((file) => !findings.some((f) => f.file === file && f.problem === 'noCard'));
    expect(stale).toEqual([]);
  });

  describe('Heuristik', () => {
    it('erkennt die Leiste in einer FormCard, auch durch ein Formular hindurch', () => {
      expect(pageBarFindings(`<FormCard>\n  <ActionForm action={a}>\n    <FormActionBar state={s} />\n  </ActionForm>\n</FormCard>`)).toEqual([]);
    });

    it('Gegenprobe: ohne FormCard, mit overflow-hidden am Vorfahren', () => {
      expect(pageBarFindings(`<form className="overflow-hidden rounded-lg border">\n  <FormActionBar />\n</form>`)).toEqual([
        { line: 2, problem: 'noCard' },
        { line: 2, problem: 'scroller' },
      ]);
      expect(pageBarFindings(`<FormCard>\n<Tabs className="overflow-hidden">\n<FormActionBar />\n</Tabs>\n</FormCard>`)).toEqual([{ line: 3, problem: 'scroller' }]);
      expect(pageBarFindings(`<FormCard>\n<div className="overflow-y-auto">\n<FormActionBar placement="page" />\n</div>\n</FormCard>`)).toEqual([{ line: 3, problem: 'scroller' }]);
    });

    it('ein Geschwister mit overflow-auto, Dialog-Leisten und Typparameter stören nicht', () => {
      const text = `const [x] = useState<Kontakt | null>(null);\n<FormCard className="grid">\n<div className="flex-1 overflow-auto">{rows}</div>\n<br/>\n<FormActionBar count={1} />\n</FormCard>\n<div className="overflow-hidden"><FormActionBar cancel={close} /><FormActionBar placement="dialog" /></div>`;
      expect(pageBarFindings(text)).toEqual([]);
    });

    it('Gegenprobe: FormCard mit overflow-hidden', () => {
      expect(scrollingCards(`<FormCard className="overflow-hidden">x</FormCard>`)).toEqual([1]);
      expect(scrollingCards(`<FormCard className="mb-6">x</FormCard>`)).toEqual([]);
    });
  });
});
