import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * Aktionen am ganzen Datensatz (Löschen, Archivieren, Stornieren) stehen auf einer Seite im Kopf (`RecordActions`),
 * nie in der Speicherleiste (Spec Seitenkopf § 3.3, docs/MUSTER.md § C). `FormActionBar recordAction` gibt es nur im
 * Fuß, der nicht klebt — Dialog und Seitenfenster, ausdrücklich `placement="dialog"`. Der Typ schließt die Seite
 * schon aus; dieser Wächter fängt, was am Typ vorbeigeht (ein `as`, ein ausgebreitetes Objekt).
 *
 * Dazu `PageHeader status`: nur eine `StatusBadge` (Freigabe Designer 2026-10-08) — im Typ nicht scharf zu fassen.
 */
export function misplacedRecordActions(text: string): number[] {
  return openingTags(text, /FormActionBar/)
    .filter(({ tag }) => /\brecordAction\s*=/.test(tag) && !/\bplacement="dialog"/.test(tag))
    .map(({ line }) => line);
}

/**
 * Der Ausdruck im Attribut `status={…}` des Tags selbst (bis zur passenden Klammer) — nicht ein `status=` eines
 * verschachtelten Elements in `actions={…}`. Jedes Element darin muss eine `StatusBadge` sein.
 */
function statusExpression(tag: string): string | null {
  let depth = 0;
  for (let i = 0; i < tag.length; i += 1) {
    const ch = tag[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && /\sstatus=\{$/.test(tag.slice(Math.max(0, i - 8), i + 2))) {
      let inner = 0;
      for (let j = i + 1; j < tag.length; j += 1) {
        if (tag[j] === '{') inner += 1;
        else if (tag[j] === '}' && (inner -= 1) === 0) return tag.slice(i + 2, j);
      }
      return tag.slice(i + 2);
    }
  }
  return null;
}

/** Die Marken-Bausteine aus MUSTER § F; `EntryStateBadge` baut auf `StatusBadge` auf (Board § K Ziel 5). */
const BADGES = new Set(['StatusBadge', 'EntryStateBadge']);

export function statusNotBadge(text: string): number[] {
  return openingTags(text, /PageHeader/)
    .filter(({ tag }) => {
      const expression = statusExpression(tag);
      if (expression === null) return false;
      const elements = [...expression.matchAll(/<([A-Za-z][\w.]*)/g)].map((m) => m[1]);
      return elements.length === 0 || elements.some((name) => !BADGES.has(name!));
    })
    .map(({ line }) => line);
}

describe('recordAction nur im Dialogfuß', () => {
  it('jedes FormActionBar mit recordAction hat placement="dialog"', () => {
    const violations = sourceFiles().flatMap((file) => misplacedRecordActions(read(file)).map((line) => `${relative(file)}:${line}`));
    expect(violations).toEqual([]);
  });

  it('PageHeader status ist eine StatusBadge', () => {
    const violations = sourceFiles().flatMap((file) => statusNotBadge(read(file)).map((line) => `${relative(file)}:${line}`));
    expect(violations).toEqual([]);
  });

  it('Heuristik: ohne placement ein Treffer, mit placement="dialog" keiner', () => {
    expect(misplacedRecordActions('<FormActionBar recordAction={x} />')).toEqual([1]);
    expect(misplacedRecordActions('<FormActionBar\n  placement="page"\n  recordAction={x}\n/>')).toEqual([1]);
    expect(misplacedRecordActions('<FormActionBar placement="dialog" cancel={c} recordAction={x} />')).toEqual([]);
    expect(misplacedRecordActions('<FormActionBar cancel={c} />')).toEqual([]);
  });

  it('Heuristik: status mit StatusBadge (auch bedingt) ist erlaubt, anderes nicht', () => {
    expect(statusNotBadge('<PageHeader title="x" status={<StatusBadge tone="neutral">a</StatusBadge>} />')).toEqual([]);
    expect(statusNotBadge('<PageHeader title="x" status={archived ? <StatusBadge tone="neutral">a</StatusBadge> : undefined} />')).toEqual([]);
    expect(statusNotBadge('<PageHeader title="x" status={archived ? undefined : <StatusBadge tone="neutral">{t(\'a\')}</StatusBadge>} />')).toEqual([]);
    // Die Marken-Bausteine aus MUSTER § F (`EntryStateBadge` baut auf `StatusBadge` auf) zählen mit.
    expect(statusNotBadge('<PageHeader title="x" status={<EntryStateBadge entry={entry} />} />')).toEqual([]);
    expect(statusNotBadge('<PageHeader title="x" status={<span>archiviert</span>} />')).toEqual([1]);
    expect(statusNotBadge('<PageHeader title="x" status={label} />')).toEqual([1]);
    expect(statusNotBadge('<PageHeader title="x" />')).toEqual([]);
    expect(statusNotBadge('<PageHeader title="x" actions={<DocumentActions status={doc.status} />} />')).toEqual([]);
  });
});
