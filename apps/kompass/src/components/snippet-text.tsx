import { SNIPPET_MARK_END, SNIPPET_MARK_START } from '@kompass/module-dms';

export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * Zerlegt die Passage aus `snippet()` in markierte und unmarkierte Stücke.
 *
 * Die Markierung kommt als Steuerzeichen und nicht als `<mark>`, damit hier
 * zerlegt statt entschärft werden muss: Der Inhalt stammt aus einem PDF, das
 * jemand von außen geschickt hat. React setzt Zeichenketten als Text; damit ist
 * die Frage „was, wenn im Dokument Markup steht?“ gar nicht erst eine.
 */
export function splitSnippet(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = raw;

  while (rest.length > 0) {
    const start = rest.indexOf(SNIPPET_MARK_START);
    if (start === -1) {
      parts.push({ text: rest, marked: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), marked: false });

    const end = rest.indexOf(SNIPPET_MARK_END, start);
    if (end === -1) {
      parts.push({ text: rest.slice(start + 1), marked: false });
      break;
    }
    parts.push({ text: rest.slice(start + 1, end), marked: true });
    rest = rest.slice(end + 1);
  }

  return parts;
}

export function SnippetText({ value }: { value: string }) {
  return (
    <>
      {splitSnippet(value).map((part, index) =>
        part.marked ? (
          <mark key={index} className="rounded-xs bg-brand-soft px-0.5 font-medium text-brand-ink">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
